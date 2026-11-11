import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { startApi } from './harness.ts';

test('papelera de 30 días y vistas reducidas', async t => {
  const api = await startApi();
  const db = api.localDb;
  const { emptyOldTrash } = await import('../maintenance.ts'); const { assetsDir } = await import('../storage.ts');
  const base = api.origin;
  try {
    await t.test('solo borra lo eliminado hace más de 30 días; conserva subpáginas y eventos enlazados', async () => {
      const old = randomUUID(), recent = randomUUID(), child = randomUUID(), event = randomUUID(), thread = randomUUID(), boardOld = `qa-${randomUUID()}`;
      const ago = (days: number) => new Date(Date.now() - days * 864e5).toISOString();
      const page = (title: string, extra: object = {}) => ({ parent_id: null, title, icon: null, cover_image: null, content: [], is_favorite: false, created_at: ago(40), ...extra });
      db.insert('documents', old, page('QA vieja', { deleted_at: ago(31) }));
      db.insert('documents', recent, page('QA reciente', { deleted_at: ago(29) }));
      db.insert('documents', child, page('QA hija', { parent_id: old }));
      db.insert('hyperthreads', thread, { source_doc_id: old, source_text: 'x', source_block_id: null, destination_type: null, destination_id: null, destination_title: 'y', destination_path: '/z', created_at: ago(40) });
      db.insert('events', event, { title: 'QA evento', description: '', emoji: null, color: '#2383e2', priority: 'media', all_day: false, start_at: ago(1), end_at: ago(1), completed: false, document_id: old, created_at: ago(1) });
      db.insert('whiteboards', boardOld, { name: 'QA pizarra', snapshot: {}, deleted_at: ago(40) });
      const removed = emptyOldTrash(30, { db, remote: false });
      assert.deepEqual(removed, { events: 0, whiteboards: 1, documents: 1 });
      assert.deepEqual(db.all('documents').map(r => r.id).sort(), [child, recent].sort(), 'la vieja se borró; la reciente y la hija siguen');
      assert.equal(db.get('documents', child)!.parent_id, null, 'la hija queda en la raíz');
      assert.equal(db.get('events', event)!.document_id, null, 'el evento se conserva sin enlace');
      assert.equal(db.get('hyperthreads', thread), undefined);
      assert.equal(db.raw('whiteboards', boardOld), undefined);
    });
    await t.test('vista reducida: solo WebP, se guarda y se sirve en /assets/previews/', async () => {
      const id = randomUUID();
      const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(200, 1)]);
      const put = await fetch(`${base}/api/assets/${id}/preview`, { method: 'PUT', headers: { 'Content-Type': 'image/webp' }, body: webp });
      assert.equal(put.status, 200);
      assert.deepEqual(await put.json(), { url: `/assets/previews/${id}.webp` });
      const head = await fetch(`${base}/assets/previews/${id}.webp`, { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal((await fetch(`${base}/assets/previews/${randomUUID()}.webp`, { method: 'HEAD' })).status, 404);
      assert.equal((await fetch(`${base}/api/assets/${id}/preview`, { method: 'PUT', headers: { 'Content-Type': 'image/webp' }, body: Buffer.from('<svg>no es webp</svg>') })).status, 415);
      assert.equal((await fetch(`${base}/api/assets/no-es-uuid/preview`, { method: 'PUT', headers: { 'Content-Type': 'image/webp' }, body: webp })).status, 400);
      await rm(path.join(assetsDir, 'previews', `${id}.webp`), { force: true });
      assert.equal(existsSync(path.join(assetsDir, 'previews', `${id}.webp`)), false);
    });
  } finally { await api.close(); }
});
