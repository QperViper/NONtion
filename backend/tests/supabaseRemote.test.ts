import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { SupabaseRemote } from '../sync.ts';

/** Servidor que imita PostgREST lo justo para ver qué consultas envía supabase-js. */
test('SupabaseRemote: update y delete condicionados a la versión, errores de clave foránea y sin conexión', async () => {
  const seen: { method: string; url: string; body: string }[] = [];
  let reply: (method: string, url: URL) => [number, unknown] = () => [200, []];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      seen.push({ method: req.method!, url: decodeURIComponent(req.url!), body });
      const [status, data] = reply(req.method!, new URL(req.url!, 'http://x'));
      res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const remote = new SupabaseRemote(`http://127.0.0.1:${(server.address() as { port: number }).port}`, 'sb_secret_test');
  try {
    reply = () => [200, [{ id: 'a' }]];
    assert.equal(await remote.update('documents', 'a', 4, { title: 'x', version: 5 }), 'ok');
    const update = seen.at(-1)!;
    assert.equal(update.method, 'PATCH');
    assert.match(update.url, /\/rest\/v1\/documents\?.*id=eq\.a/);
    assert.match(update.url, /version=eq\.4/, 'solo si la versión remota sigue siendo la base');
    assert.deepEqual(JSON.parse(update.body), { title: 'x', version: 5 });

    reply = () => [200, []];
    assert.equal(await remote.update('documents', 'a', 4, { title: 'x', version: 5 }), 'stale', 'sin filas afectadas = otro equipo escribió');

    reply = () => [409, { code: '23503', message: 'violates foreign key constraint', details: '' }];
    assert.equal(await remote.insert('documents', { id: 'b' }), 'missing-reference');
    reply = () => [409, { code: '23505', message: 'duplicate key', details: '' }];
    assert.equal(await remote.insert('documents', { id: 'b' }), 'exists');

    reply = (method) => method === 'DELETE' ? [200, []] : [200, { id: 'c', version: 9 }];
    assert.equal(await remote.remove('events', 'c', 8), 'stale');
    assert.ok(seen.some(r => r.method === 'DELETE' && /version=eq\.8/.test(r.url)));

    reply = (_m, url) => [200, Number(url.searchParams.get('offset')) > 0 ? [] : [{ id: 'a', version: 2 }, { id: 'b', version: 7 }]];
    assert.deepEqual(await remote.versions('documents'), [{ id: 'a', version: 2 }, { id: 'b', version: 7 }]);

    reply = () => [401, { code: '42501', message: 'permission denied', details: '' }];
    await assert.rejects(remote.version('documents', 'a'), /SUPABASE_SECRET_KEY/);
  } finally { server.close(); }

  const unreachable = new SupabaseRemote('http://127.0.0.1:1', 'k');
  await assert.rejects(unreachable.versions('documents'), (error: { offline?: boolean }) => error.offline === true);
});
