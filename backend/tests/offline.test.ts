import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { upsertRows } from '../../src/lib/localCache.ts';

test('la copia local del espacio reemplaza o agrega filas por id sin perder campos', () => {
  const list = [{ id: 'a', title: 'Uno', version: 1, thread_links: ['/hilo/x'] }, { id: 'b', title: 'Dos', version: 1 }];
  const out = upsertRows(list, [{ id: 'a', title: 'Uno bis', version: 2 }, { id: 'c', title: 'Tres', version: 1 }]);
  assert.deepEqual(out.map(r => r.id), ['a', 'b', 'c']);
  assert.equal(out[0].title, 'Uno bis');
  assert.deepEqual(out[0].thread_links, ['/hilo/x'], 'conserva lo que la fila nueva no trae');
  assert.equal(list[0].title, 'Uno', 'no modifica la lista original');
});

test('sin base de datos la API arranca igual: salud 503 y rutas de datos 503 con aviso claro', async () => {
  const port = 41000 + Math.floor(Math.random() * 1000);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const child = spawn(process.execPath, ['--import', './backend/node_modules/tsx/dist/loader.mjs', 'backend/server.ts'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    // Puerto cerrado: simula estar sin internet. dotenv no pisa variables ya definidas.
    env: { ...process.env, PORT: String(port), DATABASE_URL: 'postgres://x:y@127.0.0.1:1/nada', DATABASE_SSL: 'off' },
  });
  let output = '';
  child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { output += d; });
  try {
    const base = `http://127.0.0.1:${port}/api`;
    let health: Response | undefined;
    for (let i = 0; i < 60 && !health; i++) {
      health = await fetch(`${base}/health`).catch(() => undefined);
      if (!health) await new Promise(r => setTimeout(r, 250));
    }
    assert.ok(health, `la API no abrió el puerto: ${output}`);
    assert.equal(health.status, 503);
    assert.equal((await health.json() as { ok: boolean }).ok, false);
    const started = performance.now();
    const bootstrap = await fetch(`${base}/bootstrap`);
    assert.equal(bootstrap.status, 503);
    assert.match((await bootstrap.json() as { error: string }).error, /Sin conexión con Supabase/);
    assert.ok(performance.now() - started < 1000, 'responde al instante, sin esperar a la base');
    await new Promise(r => setTimeout(r, 500));
    assert.match(output, /Sin conexión con la base de datos; se reintenta/);
  } finally { child.kill(); }
});
