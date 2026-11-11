import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { upsertRows } from '../../src/lib/localCache.ts';

test('la copia local del espacio reemplaza o agrega filas por id sin perder campos', () => {
  const list = [{ id: 'a', title: 'Uno', version: 1, thread_links: ['/hilo/x'] }, { id: 'b', title: 'Dos', version: 1 }];
  const out = upsertRows(list, [{ id: 'a', title: 'Uno bis', version: 2 }, { id: 'c', title: 'Tres', version: 1 }]);
  assert.deepEqual(out.map(r => r.id), ['a', 'b', 'c']);
  assert.equal(out[0].title, 'Uno bis');
  assert.deepEqual(out[0].thread_links, ['/hilo/x'], 'conserva lo que la fila nueva no trae');
  assert.equal(list[0].title, 'Uno', 'no modifica la lista original');
});

test('sin internet la API arranca y funciona igual: datos locales al instante, sincronización en espera', async () => {
  const port = 41000 + Math.floor(Math.random() * 1000);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'nontion-offline-'));
  const child = spawn(process.execPath, ['--import', './backend/node_modules/tsx/dist/loader.mjs', 'backend/server.ts'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    // Puerto cerrado: simula estar sin internet. dotenv no pisa variables ya definidas.
    env: { ...process.env, PORT: String(port), NONTION_DATA_DIR: dataDir, SUPABASE_URL: 'http://127.0.0.1:1', SUPABASE_SECRET_KEY: 'sb_secret_x', NONTION_SYNC_DEBOUNCE_MS: '200' },
  });
  let output = '';
  child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { output += d; });
  try {
    const base = `http://127.0.0.1:${port}/api`;
    let health: Response | undefined;
    for (let i = 0; i < 120 && !health; i++) {
      health = await fetch(`${base}/health`).catch(() => undefined);
      if (!health) await new Promise(r => setTimeout(r, 250));
    }
    assert.ok(health, `la API no abrió el puerto: ${output}`);
    assert.equal(health.status, 200);
    const started = performance.now();
    const bootstrap = await fetch(`${base}/bootstrap`);
    assert.equal(bootstrap.status, 200);
    assert.ok(performance.now() - started < 1000, 'responde al instante, sin esperar a la nube');
    const created = await fetch(`${base}/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"title":"Escrito sin internet"}' });
    assert.equal(created.status, 201);
    const manual = await (await fetch(`${base}/sync`, { method: 'POST' })).json() as { state: string; pending: number; result: { ok: boolean } };
    assert.equal(manual.result.ok, false); assert.equal(manual.state, 'offline'); assert.ok(manual.pending >= 1, 'el cambio queda pendiente');
    const file = JSON.parse(readFileSync(path.join(dataDir, 'local_db.json'), 'utf8')) as { documents: Record<string, { title: string; _dirty: boolean }> };
    assert.ok(Object.values(file.documents).some(d => d.title === 'Escrito sin internet' && d._dirty));
  } finally { child.kill(); await new Promise(r => setTimeout(r, 300)); rmSync(dataDir, { recursive: true, force: true }); }
});
