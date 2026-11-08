// Copia el espacio de la base local (LOCAL_DATABASE_URL) a la base de destino (DATABASE_URL, Supabase)
// y sube las imágenes de backend/data/assets/ a Supabase Storage. La base local no se modifica.
//   node --import ./backend/node_modules/tsx/dist/loader.mjs backend/transfer.ts [--reemplazar | --solo-imagenes]
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { pool, poolConfig } from './db.ts';
import { migrate } from './migrate.ts';
import { ASSET_NAME, assetsDir, cloudConfig, ensureBucket, uploadToCloud } from './storage.ts';

const TABLES = ['workspace_settings', 'documents', 'whiteboards', 'hyperthreads'] as const;
type Rows = Record<(typeof TABLES)[number], Record<string, unknown>[]>;

const say = (...parts: unknown[]) => console.log(...parts);

function sameDatabase(a: string, b: string) {
  const norm = (u: string) => { const x = new URL(u); return `${x.hostname}:${x.port || 5432}/${x.pathname}`.toLowerCase(); };
  try { return norm(a) === norm(b); } catch { return a === b; }
}

async function readAll(source: pg.Pool): Promise<Rows> {
  const client = await source.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const rows = {} as Rows;
    for (const table of TABLES) rows[table] = (await client.query(`SELECT * FROM ${table}`)).rows;
    await client.query('COMMIT');
    return rows;
  } finally { client.release(); }
}

async function counts(target: pg.Pool | pg.PoolClient) {
  const out: Record<string, number> = {};
  for (const table of TABLES) out[table] = Number((await target.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
  return out;
}

/** Inserta filas JSON con los tipos de la tabla de destino (jsonb, uuid, fechas…). change_xid lo pone el disparador. */
async function insert(client: pg.PoolClient, table: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const clean = rows.map(({ change_xid: _ignored, ...row }) => row);
  await client.query(`INSERT INTO ${table} SELECT * FROM json_populate_recordset(NULL::${table}, $1::json)`, [JSON.stringify(clean)]);
}

async function copyRows(target: pg.Pool, rows: Rows, replace: boolean) {
  const client = await target.connect();
  try {
    await client.query('BEGIN');
    const existing = await counts(client);
    const busy = existing.documents + existing.whiteboards + existing.hyperthreads;
    if (busy && !replace) {
      throw new Error(`La base de destino ya tiene datos (${existing.documents} páginas, ${existing.whiteboards} pizarras, ${existing.hyperthreads} conexiones). `
        + 'No se copió nada. Si quieres reemplazarlos por los de este equipo, vuelve a ejecutar con --reemplazar.');
    }
    if (busy) await client.query('DELETE FROM hyperthreads; DELETE FROM whiteboards; DELETE FROM documents;');
    await client.query('DELETE FROM workspace_settings');
    await insert(client, 'workspace_settings', rows.workspace_settings);
    // parent_id apunta a otras páginas: se insertan sin padre y luego se enlazan.
    await insert(client, 'documents', rows.documents.map(row => ({ ...row, parent_id: null })));
    const parents = rows.documents.filter(row => row.parent_id).map(row => ({ id: row.id, parent_id: row.parent_id }));
    if (parents.length) {
      await client.query(`UPDATE documents d SET parent_id = p.parent_id FROM json_to_recordset($1::json) AS p(id uuid, parent_id uuid) WHERE d.id = p.id`, [JSON.stringify(parents)]);
    }
    await insert(client, 'whiteboards', rows.whiteboards);
    await insert(client, 'hyperthreads', rows.hyperthreads);
    const copied = await counts(client);
    for (const table of TABLES) {
      if (copied[table] !== rows[table].length) throw new Error(`Recuento distinto en ${table}: origen ${rows[table].length}, destino ${copied[table]}.`);
    }
    await client.query('COMMIT');
    return copied;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

async function uploadAssets() {
  if (!cloudConfig()) return null;
  await ensureBucket();
  const names = existsSync(assetsDir) ? (await readdir(assetsDir)).filter(name => ASSET_NAME.test(name)) : [];
  let uploaded = 0, present = 0;
  for (const name of names) {
    if (await uploadToCloud(name, await readFile(path.join(assetsDir, name)))) uploaded++; else present++;
    if ((uploaded + present) % 10 === 0) say(`  imágenes: ${uploaded + present}/${names.length}`);
  }
  return { total: names.length, uploaded, present };
}

export async function transfer({ replace = false, imagesOnly = false } = {}) {
  if (imagesOnly) {
    if (!cloudConfig()) throw new Error('Faltan SUPABASE_URL y SUPABASE_SECRET_KEY en backend/.env.');
    const assets = (await uploadAssets())!;
    say(`${assets.total} imágenes: ${assets.uploaded} subidas, ${assets.present} ya estaban.`);
    return { copied: null, assets };
  }
  const sourceUrl = process.env.LOCAL_DATABASE_URL;
  const targetUrl = process.env.DATABASE_URL;
  if (!sourceUrl) throw new Error('Falta LOCAL_DATABASE_URL en backend/.env (la dirección de tu base local, la que tenías antes en DATABASE_URL).');
  if (!targetUrl) throw new Error('Falta DATABASE_URL en backend/.env (la dirección de Supabase).');
  if (sameDatabase(sourceUrl, targetUrl)) throw new Error('LOCAL_DATABASE_URL y DATABASE_URL apuntan a la misma base. DATABASE_URL debe ser la de Supabase.');

  const source = new pg.Pool(poolConfig(sourceUrl));
  try {
    say('1/5 Preparando la base local (migraciones pendientes)…');
    await migrate(source);
    say('2/5 Leyendo tu espacio local…');
    const rows = await readAll(source);
    say(`    ${rows.documents.length} páginas, ${rows.whiteboards.length} pizarras, ${rows.hyperthreads.length} conexiones.`);
    const backups = fileURLToPath(new URL('./backups/', import.meta.url));
    await mkdir(backups, { recursive: true });
    const copy = path.join(backups, `antes-de-supabase-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await writeFile(copy, JSON.stringify(rows));
    say(`    Copia de seguridad: ${copy}`);
    say('3/5 Creando las tablas en Supabase…');
    await migrate(pool);
    say('4/5 Copiando los datos…');
    const copied = await copyRows(pool, rows, replace);
    say(`    Copiado: ${copied.documents} páginas, ${copied.whiteboards} pizarras, ${copied.hyperthreads} conexiones y la apariencia.`);
    say('5/5 Subiendo imágenes a Supabase Storage…');
    let assets;
    try { assets = await uploadAssets(); }
    catch (error) {
      throw new Error(`Los datos ya están en Supabase, pero falló la subida de imágenes (${(error as Error).message}). `
        + 'Revisa SUPABASE_URL y SUPABASE_SECRET_KEY y vuelve a ejecutar con --solo-imagenes.');
    }
    if (!assets) say('    Omitido: faltan SUPABASE_URL y SUPABASE_SECRET_KEY en backend/.env. Las imágenes seguirán solo en este equipo.');
    else say(`    ${assets.total} imágenes: ${assets.uploaded} subidas, ${assets.present} ya estaban.`);
    return { copied, assets };
  } finally { await source.end(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  transfer({ replace: process.argv.includes('--reemplazar'), imagesOnly: process.argv.includes('--solo-imagenes') }).then(() => {
    say('\nListo: tu espacio está en Supabase. La base local queda intacta como respaldo.');
  }).catch(error => {
    console.error('\nNo se completó el traspaso:', error.message ?? error);
    process.exitCode = 1;
  }).finally(() => pool.end());
}
