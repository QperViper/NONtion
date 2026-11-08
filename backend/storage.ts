import { existsSync } from 'node:fs';
import { mkdir, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RequestHandler } from 'express';
import './db.ts'; // carga backend/.env

/**
 * Imágenes subidas. Siempre se guardan en backend/data/assets/ y, si Supabase Storage está configurado,
 * también en la nube. En ese caso la carpeta local funciona como caché: una imagen subida desde otro
 * equipo se descarga la primera vez que se pide y después se sirve desde el disco.
 * Las URL guardadas en notas y pizarras (/assets/<uuid>.<ext>) no cambian.
 */
export const assetsDir = fileURLToPath(new URL('./data/assets/', import.meta.url));
export const ASSET_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|gif)$/;
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

interface Cloud { url: string; key: string; bucket: string; }
export function cloudConfig(): Cloud | null {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url, key, bucket: process.env.SUPABASE_BUCKET || 'nontion-assets' };
}

async function call(cloud: Cloud, route: string, init: RequestInit = {}) {
  return fetch(`${cloud.url}/storage/v1/${route}`, {
    ...init, signal: AbortSignal.timeout(60_000),
    headers: { apikey: cloud.key, Authorization: `Bearer ${cloud.key}`, ...init.headers },
  });
}

async function failure(response: Response) {
  const body = await response.text().catch(() => '');
  return new Error(`Supabase Storage respondió ${response.status}: ${body.slice(0, 200)}`);
}

/** Crea el bucket privado si todavía no existe. */
export async function ensureBucket(cloud = cloudConfig()) {
  if (!cloud) return;
  const found = await call(cloud, `bucket/${cloud.bucket}`);
  if (found.ok) return;
  const created = await call(cloud, 'bucket', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: cloud.bucket, name: cloud.bucket, public: false, file_size_limit: 12 * 1024 * 1024, allowed_mime_types: Object.values(MIME) }),
  });
  if (!created.ok && !/already exists|Duplicate/i.test(await created.clone().text())) throw await failure(created);
}

/** Sube un archivo a la nube. Devuelve false si ya estaba (los nombres son UUID y nunca cambian). */
export async function uploadToCloud(name: string, data: Buffer, cloud = cloudConfig()) {
  if (!cloud) return false;
  const response = await call(cloud, `object/${cloud.bucket}/${name}`, {
    method: 'POST', body: new Uint8Array(data),
    headers: { 'Content-Type': MIME[name.split('.').pop()!], 'x-upsert': 'false', 'cache-control': '31536000' },
  });
  if (response.ok) return true;
  const text = await response.text();
  if (response.status === 409 || /Duplicate|already exists/i.test(text)) return false;
  throw new Error(`Supabase Storage respondió ${response.status}: ${text.slice(0, 200)}`);
}

async function downloadFromCloud(name: string, cloud: Cloud): Promise<Buffer | null> {
  const response = await call(cloud, `object/authenticated/${cloud.bucket}/${name}`);
  if (response.status === 404 || response.status === 400) return null;
  if (!response.ok) throw await failure(response);
  return Buffer.from(await response.arrayBuffer());
}

/** Lista los nombres de archivo del bucket (para completar la caché local antes de un respaldo). */
export async function listCloud(cloud = cloudConfig()): Promise<string[]> {
  if (!cloud) return [];
  const names: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await call(cloud, `object/list/${cloud.bucket}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: '', limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!response.ok) throw await failure(response);
    const page = await response.json() as { name: string }[];
    names.push(...page.map(item => item.name).filter(name => ASSET_NAME.test(name)));
    if (page.length < 1000) return names;
  }
}

async function writeCache(name: string, data: Buffer) {
  await mkdir(assetsDir, { recursive: true });
  const temporary = path.join(assetsDir, `.${name}.${process.pid}.tmp`);
  await writeFile(temporary, data);
  await rename(temporary, path.join(assetsDir, name)).catch(async () => { await unlink(temporary).catch(() => {}); });
}

/** Guarda una imagen nueva: disco local y, si corresponde, la nube. Si la nube falla, no queda a medias. */
export async function saveAsset(name: string, data: Buffer) {
  await mkdir(assetsDir, { recursive: true });
  const file = path.join(assetsDir, name);
  await writeFile(file, data, { flag: 'wx' });
  try { await uploadToCloud(name, data); }
  catch (error) { await unlink(file).catch(() => {}); throw error; }
}

const downloads = new Map<string, Promise<Buffer | null>>();
/** Descarga a la caché local una imagen que solo existe en la nube. */
export function fetchIntoCache(name: string): Promise<Buffer | null> {
  const cloud = cloudConfig();
  if (!cloud || !ASSET_NAME.test(name)) return Promise.resolve(null);
  let task = downloads.get(name);
  if (!task) {
    task = downloadFromCloud(name, cloud).then(async data => { if (data) await writeCache(name, data); return data; })
      .finally(() => downloads.delete(name));
    downloads.set(name, task);
  }
  return task;
}

/** Va después de express.static: solo llega aquí lo que no está en la caché local. */
export const cloudAssets: RequestHandler = async (req, res, next) => {
  const name = req.path.slice(1);
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  try {
    const data = await fetchIntoCache(name);
    if (!data) return next();
    res.setHeader('Content-Type', MIME[name.split('.').pop()!]);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) {
    console.error('No se pudo descargar la imagen', name, (error as Error).message);
    res.status(502).end();
  }
};

/** Descarga a la caché todas las imágenes de la nube que falten en este equipo. */
export async function syncCacheFromCloud() {
  const local = new Set(existsSync(assetsDir) ? await readdir(assetsDir) : []);
  let downloaded = 0;
  for (const name of await listCloud()) if (!local.has(name) && await fetchIntoCache(name)) downloaded++;
  return downloaded;
}
