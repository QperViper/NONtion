import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';

test('papelera de 30 días y vistas reducidas', { skip: process.env.NONTION_INTEGRATION !== '1' }, async t => {
  const { app } = await import('../app.ts'); const { pool } = await import('../db.ts');
  const { emptyOldTrash } = await import('../maintenance.ts'); const { assetsDir } = await import('../storage.ts');
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.on('listening', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await t.test('solo borra lo eliminado hace más de 30 días; conserva subpáginas y eventos enlazados', async () => {
      const old = randomUUID(), recent = randomUUID(), child = randomUUID(), event = randomUUID();
      await pool.query("INSERT INTO documents(id,title,deleted_at) VALUES ($1,'QA vieja',now()-interval '31 days'),($2,'QA reciente',now()-interval '29 days')", [old, recent]);
      await pool.query("INSERT INTO documents(id,title,parent_id) VALUES ($1,'QA hija',$2)", [child, old]);
      await pool.query("INSERT INTO hyperthreads(source_doc_id,source_text,destination_title,destination_path) VALUES ($1,'x','y','/z')", [old]);
      await pool.query("INSERT INTO events(id,title,start_at,end_at,document_id) VALUES ($1,'QA evento',now(),now(),$2)", [event, old]);
      const boardOld = (await pool.query("INSERT INTO whiteboards(id,name,deleted_at) VALUES ($1,'QA pizarra',now()-interval '40 days') RETURNING id", [`qa-${randomUUID()}`])).rows[0].id;
      const removed = await emptyOldTrash(30);
      assert.ok(removed.documents >= 1 && removed.whiteboards >= 1);
      const ids = (await pool.query('SELECT id FROM documents WHERE id = ANY($1)', [[old, recent, child]])).rows.map(r => r.id).sort();
      assert.deepEqual(ids, [child, recent].sort(), 'la vieja se borró; la reciente y la hija siguen');
      assert.equal((await pool.query('SELECT parent_id FROM documents WHERE id=$1', [child])).rows[0].parent_id, null, 'la hija queda en la raíz');
      assert.equal((await pool.query('SELECT document_id FROM events WHERE id=$1', [event])).rows[0].document_id, null, 'el evento se conserva sin enlace');
      assert.equal(Number((await pool.query('SELECT count(*) FROM hyperthreads WHERE source_doc_id=$1', [old])).rows[0].count), 0);
      assert.equal(Number((await pool.query('SELECT count(*) FROM whiteboards WHERE id=$1', [boardOld])).rows[0].count), 0);
      await pool.query('DELETE FROM documents WHERE id = ANY($1)', [[recent, child]]); await pool.query('DELETE FROM events WHERE id=$1', [event]);
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
  } finally { server.close(); await pool.end(); }
});
