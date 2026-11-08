import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { distDir, serveUi } from '../ui.ts';

test('modo producción: rutas de la app, archivos compilados y API conviven en un puerto', { skip: !existsSync(path.join(distDir, 'index.html')) && 'Ejecuta npm run build para esta prueba.' }, async () => {
  const app = express();
  app.get('/api/ping', (_req, res) => { res.json({ ok: true }); });
  app.use('/assets', (_req, res) => { res.status(404).end(); });
  assert.equal(serveUi(app), true);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.on('listening', resolve));
  const { port } = server.address() as { port: number };
  const get = (p: string) => fetch(`http://127.0.0.1:${port}${p}`);
  try {
    for (const route of ['/', '/48c997b5-a177-4445-bcd3-8849e0c4dafb', '/pizarra/main-whiteboard', '/hilo/x']) {
      const res = await get(route);
      assert.equal(res.status, 200, route);
      assert.match(await res.text(), /<div id="root">/);
      assert.equal(res.headers.get('cache-control'), 'no-cache');
    }
    assert.deepEqual(await (await get('/api/ping')).json(), { ok: true });
    assert.equal((await get('/api/inexistente')).status, 404);
    assert.equal((await get('/assets/x.png')).status, 404);
    const file = readdirSync(path.join(distDir, 'static')).find(name => name.endsWith('.js'))!;
    const res = await get(`/static/${file}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('cache-control') || '', /immutable/);
    assert.equal((await get('/static/no-existe.js')).status, 404);
  } finally { server.close(); }
});
