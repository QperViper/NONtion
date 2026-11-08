import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { poolConfig } from '../db.ts';

/** Imitación mínima de la API de Supabase Storage (las rutas y respuestas que usa la app). */
async function fakeStorage(key: string) {
  const buckets = new Set<string>();
  const objects = new Map<string, Buffer>();
  const body = (req: IncomingMessage) => new Promise<Buffer>(resolve => { const parts: Buffer[] = []; req.on('data', c => parts.push(c)); req.on('end', () => resolve(Buffer.concat(parts))); });
  const server = createServer(async (req, res) => {
    const send = (status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (req.headers.apikey !== key || req.headers.authorization !== `Bearer ${key}`) return send(401, { message: 'Invalid key' });
    const url = req.url!.replace(/^\/storage\/v1\//, '');
    const data = await body(req);
    if (req.method === 'GET' && url.startsWith('bucket/')) return buckets.has(url.slice(7)) ? send(200, { id: url.slice(7) }) : send(400, { statusCode: '404', error: 'Bucket not found' });
    if (req.method === 'POST' && url === 'bucket') { const { id } = JSON.parse(data.toString()); buckets.add(id); return send(200, { name: id }); }
    if (req.method === 'POST' && url.startsWith('object/list/')) return send(200, [...objects.keys()].map(name => ({ name: name.split('/')[1] })));
    if (req.method === 'POST' && url.startsWith('object/')) {
      const name = url.slice(7);
      if (objects.has(name)) return send(400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
      objects.set(name, data); return send(200, { Key: name });
    }
    if (req.method === 'GET' && url.startsWith('object/authenticated/')) {
      const found = objects.get(url.slice('object/authenticated/'.length));
      if (!found) return send(400, { statusCode: '404', error: 'not_found' });
      res.writeHead(200); return res.end(found);
    }
    send(404, { error: 'ruta no simulada' });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, objects, buckets, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}

test('conexión: local sin TLS, remota cifrada; sslmode de la URL no interfiere', () => {
  assert.equal(poolConfig('postgresql://u:p@127.0.0.1:5432/NONtion').ssl, false);
  assert.equal(poolConfig('postgresql://u:p@localhost/NONtion').ssl, false);
  const remote = poolConfig('postgresql://postgres.ref:p@aws-0-us-west-2.pooler.supabase.com:5432/postgres?sslmode=require');
  assert.deepEqual(remote.ssl, { rejectUnauthorized: false });
  assert.equal(remote.max, 4);
  assert.doesNotMatch(String(remote.connectionString), /sslmode/);
});

test('Supabase Storage: subir, no duplicar, descargar a la caché y servir /assets', async () => {
  const key = 'sb_secret_prueba';
  const fake = await fakeStorage(key);
  process.env.SUPABASE_URL = fake.url;
  process.env.SUPABASE_SECRET_KEY = key;
  const storage = await import('../storage.ts');
  const name = `${randomUUID()}.png`;
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  try {
    await storage.ensureBucket();
    assert.ok(fake.buckets.has('nontion-assets'));
    await storage.ensureBucket(); // segunda vez: ya existe
    await storage.saveAsset(name, png);
    assert.deepEqual(fake.objects.get(`nontion-assets/${name}`), png);
    assert.equal(await storage.uploadToCloud(name, png), false, 'un duplicado no es un error');
    // Otro equipo: la imagen no está en su caché y se descarga una sola vez aunque se pida dos veces a la vez.
    await unlink(path.join(storage.assetsDir, name));
    const [a, b] = await Promise.all([storage.fetchIntoCache(name), storage.fetchIntoCache(name)]);
    assert.deepEqual(a, png); assert.deepEqual(b, png);
    assert.deepEqual(await readFile(path.join(storage.assetsDir, name)), png);
    assert.equal(await storage.fetchIntoCache(`${randomUUID()}.png`), null);
    assert.equal(await storage.fetchIntoCache('../../etc/passwd'), null);
    // Ruta /assets completa a través de la API.
    await unlink(path.join(storage.assetsDir, name));
    const { app } = await import('../app.ts');
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.on('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const served = await fetch(`${base}/assets/${name}`);
      assert.equal(served.status, 200);
      assert.equal(served.headers.get('content-type'), 'image/png');
      assert.deepEqual(Buffer.from(await served.arrayBuffer()), png);
      assert.equal((await fetch(`${base}/assets/${randomUUID()}.png`)).status, 404);
      // Si la nube rechaza la subida, no queda una copia local huérfana.
      process.env.SUPABASE_SECRET_KEY = 'clave-mala';
      const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
      const rejected = await fetch(`${base}/api/assets`, { method: 'POST', headers: { 'Content-Type': 'image/gif' }, body: gif });
      assert.equal(rejected.status, 502);
      process.env.SUPABASE_SECRET_KEY = key;
      // Completar la caché desde la nube (lo usa el respaldo diario).
      await unlink(path.join(storage.assetsDir, name));
      assert.equal(await storage.syncCacheFromCloud(), 1);
      assert.ok(existsSync(path.join(storage.assetsDir, name)));
    } finally { server.close(); }
  } finally {
    await unlink(path.join(storage.assetsDir, name)).catch(() => {});
    fake.server.close();
    delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SECRET_KEY;
    const { pool } = await import('../db.ts'); await pool.end().catch(() => {});
  }
});

test('traspaso: copia todo de la base local a otra base, sube imágenes y se niega a pisar datos', { skip: process.env.NONTION_TRANSFER_TARGET ? false : 'Define NONTION_TRANSFER_TARGET (base vacía de pruebas).' }, async () => {
  const target = process.env.NONTION_TRANSFER_TARGET!;
  const source = new pg.Pool(poolConfig(process.env.DATABASE_URL));
  const key = 'sb_secret_traspaso';
  const fake = await fakeStorage(key);
  const saved = { db: process.env.DATABASE_URL, local: process.env.LOCAL_DATABASE_URL };
  process.env.SUPABASE_URL = fake.url; process.env.SUPABASE_SECRET_KEY = key;
  process.env.LOCAL_DATABASE_URL = process.env.DATABASE_URL; process.env.DATABASE_URL = target;
  try {
    const expected = Object.fromEntries(await Promise.all(['documents', 'whiteboards', 'hyperthreads'].map(async t => [t, Number((await source.query(`SELECT count(*) FROM ${t}`)).rows[0].count)])));
    const sample = (await source.query('SELECT id, content FROM documents ORDER BY id LIMIT 1')).rows[0];
    // db.ts creó su pool con DATABASE_URL al importarse por primera vez en este proceso: se usa un subproceso limpio.
    // Asíncrono: este mismo proceso atiende la imitación de Storage.
    const { execFile } = await import('node:child_process');
    const run = (...args: string[]) => new Promise<string>((resolve, reject) => execFile(process.execPath, ['--import', './backend/node_modules/tsx/dist/loader.mjs', 'backend/transfer.ts', ...args],
      { cwd: path.resolve(import.meta.dirname, '../..'), env: process.env, encoding: 'utf8' }, (error, stdout, stderr) => error ? reject(new Error(stderr || error.message)) : resolve(stdout)));
    const output = await run();
    assert.match(output, /Listo/);
    const copy = new pg.Pool(poolConfig(target));
    try {
      for (const [table, count] of Object.entries(expected)) assert.equal(Number((await copy.query(`SELECT count(*) FROM ${table}`)).rows[0].count), count, table);
      if (sample) assert.deepEqual((await copy.query('SELECT content FROM documents WHERE id=$1', [sample.id])).rows[0].content, sample.content);
      assert.equal(Number((await copy.query('SELECT count(*) FROM documents WHERE change_xid IS NULL')).rows[0].count), 0);
      assert.ok(fake.buckets.has('nontion-assets'));
      assert.ok(fake.objects.size > 0, 'sube las imágenes locales');
      // Segunda ejecución sin --reemplazar: no toca nada.
      await assert.rejects(run(), /ya tiene datos/);
      assert.match(await run('--reemplazar'), /Listo/);
      const before = fake.objects.size;
      assert.match(await run('--solo-imagenes'), /ya estaban/);
      assert.equal(fake.objects.size, before);
      assert.equal(Number((await copy.query('SELECT count(*) FROM documents')).rows[0].count), expected.documents);
    } finally { await copy.end(); }
  } finally {
    process.env.DATABASE_URL = saved.db; process.env.LOCAL_DATABASE_URL = saved.local;
    delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SECRET_KEY;
    fake.server.close(); await source.end();
  }
});
