import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';

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

test('Supabase Storage: subir, no duplicar, descargar a la caché y servir /assets', async () => {
  const key = 'sb_secret_prueba';
  const fake = await fakeStorage(key);
  process.env.SUPABASE_URL = fake.url;
  process.env.SUPABASE_SECRET_KEY = key;
  process.env.NONTION_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'nontion-cloud-'));
  const storage = await import('../storage.ts');
  const name = `${randomUUID()}.png`;
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  try {
    await storage.ensureBucket();
    assert.ok(fake.buckets.has('nontion-assets'));
    await storage.ensureBucket(); // segunda vez: ya existe
    assert.deepEqual(await storage.saveAsset(name, png), { uploaded: true });
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
      // Si la nube no responde (sin internet), la imagen se guarda en local y queda pendiente para la sincronización.
      process.env.SUPABASE_SECRET_KEY = 'clave-mala';
      const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
      const accepted = await fetch(`${base}/api/assets`, { method: 'POST', headers: { 'Content-Type': 'image/gif' }, body: gif });
      assert.equal(accepted.status, 201);
      const pendingName = (await accepted.json() as { url: string }).url.replace('/assets/', '');
      const { localDb } = await import('../localDb.ts');
      assert.deepEqual(localDb.meta.pending_assets, [pendingName]);
      process.env.SUPABASE_SECRET_KEY = key;
      // La sincronización la sube después.
      assert.equal(await storage.uploadPending(pendingName), true);
      assert.ok(fake.objects.has(`nontion-assets/${pendingName}`));
      // Completar la caché desde la nube (lo usa el respaldo diario).
      await unlink(path.join(storage.assetsDir, name));
      assert.equal(await storage.syncCacheFromCloud(), 1);
      assert.ok(existsSync(path.join(storage.assetsDir, name)));
    } finally { server.close(); }
  } finally {
    await unlink(path.join(storage.assetsDir, name)).catch(() => {});
    fake.server.close();
    delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SECRET_KEY;
  }
});
