import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { startApi } from './harness.ts';

test('API sobre local_db.json: persistencia, versiones, hiperhilos, papelera, cursor y archivos', async t => {
  const api = await startApi();
  const { call, origin } = api;
  try {
    const doc = await call('/documents', 'POST', { title: 'QA API temporal' }); assert.equal(doc.status, 201);
    const id = doc.data.id;
    assert.equal(doc.data._dirty, undefined, 'los campos de control no salen por la API');

    await t.test('solo una escritura con la misma versión puede confirmar', async () => {
      const outcomes = await Promise.all([call(`/documents/${id}`, 'PATCH', { version: 1, title: 'A' }), call(`/documents/${id}`, 'PATCH', { version: 1, title: 'B' })]);
      assert.deepEqual(outcomes.map(r => r.status).sort(), [200, 409]);
      const conflict = outcomes.find(r => r.status === 409)!; assert.equal(conflict.data.current.version, 2);
      const saved = await call(`/documents/${id}`, 'PATCH', { version: 2, title: 'QA API temporal', content: [{ id: 'qa-block', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Persistente', styles: {} }], children: [] }] });
      assert.equal(saved.status, 200); assert.equal(saved.data.content, undefined, 'PATCH no repite el contenido');
      const full = await call(`/documents/${id}`); assert.equal(full.status, 200); assert.equal(full.data.content[0].content[0].text, 'Persistente');
    });

    await t.test('lo guardado está en local_db.json con los campos de control', async () => {
      const file = JSON.parse(await readFile(path.join(api.dir, 'local_db.json'), 'utf8'));
      const row = file.documents[id];
      assert.equal(row.version, 3); assert.equal(row._dirty, true); assert.equal(row._base_version, 0);
      assert.equal(row.deleted_at, null); assert.ok(Date.parse(row.updated_at));
      assert.ok(row._dirty_fields.includes('content'));
    });

    const board = await call('/whiteboards', 'POST', { title: 'QA API lienzo' }); assert.equal(board.status, 201);
    await t.test('un snapshot se conserva íntegro', async () => {
      const snapshot = { document: { schema: { schemaVersion: 2, sequences: {} }, store: { 'page:qa': { id: 'page:qa', typeName: 'page', name: 'QA' } } } };
      const result = await call(`/whiteboards/${board.data.id}`, 'PATCH', { version: 1, snapshot }); assert.equal(result.status, 200); assert.equal(result.data.snapshot, undefined);
      assert.deepEqual((await call(`/whiteboards/${board.data.id}`)).data.snapshot, snapshot);
    });

    await t.test('conexión estable, creación idempotente y papelera reversible', async () => {
      const threadId = randomUUID();
      const connection = { id: threadId, sourceDocId: id, sourceText: 'Persistente', sourceBlockId: 'qa-block', destinationType: 'whiteboard', destinationId: board.data.id };
      const saved = await call('/connections', 'POST', connection); assert.equal(saved.status, 201); assert.equal(saved.data.destination_id, board.data.id);
      assert.equal(saved.data.destination_title, 'QA API lienzo'); assert.equal(saved.data.destination_path, `/pizarra/${board.data.id}`);
      const repeated = await call('/connections', 'POST', connection); assert.equal(repeated.data.id, threadId);
      const removed = await call(`/whiteboards/${board.data.id}`, 'PATCH', { version: 2, deletedAt: new Date().toISOString() }); assert.equal(removed.status, 200); assert.ok(removed.data.deleted_at);
      const denied = await call('/connections', 'POST', { ...connection, id: randomUUID() }); assert.equal(denied.status, 404);
      const restored = await call(`/whiteboards/${board.data.id}`, 'PATCH', { version: 3, deletedAt: null }); assert.equal(restored.status, 200); assert.equal(restored.data.deleted_at, null);
      const bootstrap = await call('/bootstrap'); assert.equal(bootstrap.status, 200); assert.equal(bootstrap.data.connections.filter((c: { id: string }) => c.id === threadId).length, 1);
    });

    await t.test('arranque liviano y cambios desde un cursor', async () => {
      const boot = await call('/bootstrap'); assert.match(boot.data.cursor, /^\d+$/);
      assert.ok(boot.data.settings.theme_color);
      const mine = boot.data.documents.find((d: { id: string }) => d.id === id);
      assert.equal(mine.content, undefined, 'el arranque no trae contenido'); assert.ok(Array.isArray(mine.thread_links));
      assert.equal(boot.data.whiteboards.find((b: { id: string }) => b.id === board.data.id).snapshot, undefined);
      let cursor = boot.data.cursor;
      const quiet = await call(`/changes?since=${cursor}`);
      assert.equal(quiet.status, 200); assert.deepEqual(quiet.data.documents, []); assert.equal(quiet.data.settings, null); cursor = quiet.data.cursor;
      const before = await call(`/documents/${id}`);
      const linked = [{ id: 'qa-link', type: 'paragraph', props: {}, content: [{ type: 'link', href: '/hilo/qa-123', content: [{ type: 'text', text: 'x', styles: {} }] }], children: [{ type: 'paragraph', content: [{ type: 'link', href: '/hilo/qa-456', content: [] }] }] }];
      const edited = await call(`/documents/${id}`, 'PATCH', { version: before.data.version, content: linked }); assert.deepEqual(edited.data.thread_links, ['/hilo/qa-123', '/hilo/qa-456']);
      const changed = await call(`/changes?since=${cursor}`);
      assert.deepEqual(changed.data.documents.map((d: { id: string }) => d.id), [id]); assert.equal(changed.data.documents[0].content, undefined);
      assert.deepEqual(changed.data.whiteboards, []);
      assert.equal((await call('/changes?since=abc')).status, 400);
      const legacy = await call('/changes?since=99999999999'); // cursor guardado de la época de PostgreSQL
      assert.ok(legacy.data.documents.length >= 1, 'un cursor desconocido devuelve todo');
      assert.equal((await call(`/whiteboards/no-existe-${randomUUID()}`)).status, 404);
    });

    await t.test('errores HTTP explícitos para entradas y recursos inválidos', async () => {
      assert.equal((await call(`/documents/${id}`, 'PATCH', { title: 'sin versión' })).status, 400);
      assert.equal((await call(`/documents/${randomUUID()}`, 'PATCH', { version: 1, title: 'ausente' })).status, 404);
      assert.equal((await call(`/documents/${id}`, 'PATCH', { version: 3, content: 'texto' })).status, 400);
    });

    await t.test('ajustes: PATCH con versión', async () => {
      const boot = await call('/bootstrap');
      const ok = await call('/settings', 'PATCH', { version: boot.data.settings.version, bgBlur: 7 });
      assert.equal(ok.status, 200); assert.equal(ok.data.bg_blur, 7);
      assert.equal((await call('/settings', 'PATCH', { version: boot.data.settings.version, bgBlur: 8 })).status, 409);
    });

    await t.test('salud y sincronización: sin Supabase configurada responde al instante', async () => {
      const health = await call('/health'); assert.equal(health.status, 200); assert.equal(health.data.ok, true);
      assert.equal(health.data.sync.state, 'disabled');
      const manual = await call('/sync', 'POST'); assert.equal(manual.status, 200); assert.equal(manual.data.result.state, 'disabled');
    });

    await t.test('GIF subido sigue accesible y formatos falsos se rechazan (sin nube, no falla)', async () => {
      const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
      const upload = await fetch(`${origin}/api/assets`, { method: 'POST', headers: { 'Content-Type': 'image/gif' }, body: gif });
      assert.equal(upload.status, 201); const result = await upload.json() as { url: string };
      const fetched = await fetch(`${origin}${result.url}`); assert.equal(fetched.status, 200); assert.deepEqual(Buffer.from(await fetched.arrayBuffer()), gif);
      const bad = await fetch(`${origin}/api/assets`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: 'not png' }); assert.equal(bad.status, 400);
    });
  } finally { await api.close(); }
});
