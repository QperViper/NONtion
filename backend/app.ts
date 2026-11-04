import express from 'express';
import type { ErrorRequestHandler } from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from './db.ts';
import { HttpError, object, text, uuid, validatePatch } from './validation.ts';

export const app = express();
app.disable('x-powered-by');
app.use(cors({ origin(origin, callback) {
  if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) callback(null, true);
  else callback(new HttpError(403, 'Origen no permitido.'));
} }));
app.use(express.json({ limit: '20mb' }));
const assets = new URL('./data/assets/', import.meta.url);
app.use('/assets', express.static(fileURLToPath(assets), { immutable: true, maxAge: '1y', setHeaders(res) { res.setHeader('X-Content-Type-Options', 'nosniff'); } }));
app.post('/api/assets', express.raw({ type: ['image/png','image/jpeg','image/webp','image/gif'], limit: '12mb' }), async (req, res) => {
  const data = req.body;
  if (!Buffer.isBuffer(data) || !data.length) throw new HttpError(400, 'Sube PNG, JPG, WebP o GIF (máximo 12 MB).');
  const mime = req.get('content-type')?.split(';')[0];
  const valid = mime === 'image/png' ? data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : mime === 'image/jpeg' ? data[0] === 255 && data[1] === 216 && data[2] === 255
    : mime === 'image/gif' ? /^GIF8[79]a$/.test(data.subarray(0,6).toString())
    : mime === 'image/webp' && data.subarray(0,4).toString() === 'RIFF' && data.subarray(8,12).toString() === 'WEBP';
  if (!valid) throw new HttpError(400, 'El archivo no corresponde a su formato.');
  const extension = ({ 'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif' } as Record<string,string>)[mime!];
  const filename = `${randomUUID()}.${extension}`;
  await mkdir(assets, { recursive: true });
  await writeFile(new URL(filename, assets), data, { flag: 'wx' });
  res.status(201).json({ url: `/assets/${filename}` });
});
app.get('/api/health', async (_req,res) => { await pool.query('SELECT 1'); res.json({ ok: true }); });
app.get('/api/bootstrap', async (_req,res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const settings = await client.query('SELECT * FROM workspace_settings WHERE id=1');
    const documents = await client.query('SELECT * FROM documents ORDER BY created_at,id');
    const whiteboards = await client.query('SELECT * FROM whiteboards ORDER BY updated_at,id');
    const connections = await client.query('SELECT * FROM hyperthreads ORDER BY created_at DESC,id');
    await client.query('COMMIT');
    res.json({ settings: settings.rows[0], documents: documents.rows, whiteboards: whiteboards.rows, connections: connections.rows });
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
});
app.post('/api/documents', async (req,res) => {
  const body = object(req.body);
  const title = body.title === undefined ? 'Sin título' : text(body.title);
  const result = await pool.query('INSERT INTO documents(title) VALUES($1) RETURNING *',[title]);
  res.status(201).json(result.rows[0]);
});
app.post('/api/whiteboards', async (req,res) => {
  const body = object(req.body);
  const title = body.title === undefined ? 'Nueva pizarra' : text(body.title);
  const result = await pool.query('INSERT INTO whiteboards(id,name) VALUES($1,$2) RETURNING *',[randomUUID(),title]);
  res.status(201).json(result.rows[0]);
});
for (const [route, table, kind] of [
  ['settings','workspace_settings','settings'], ['documents','documents','document'], ['whiteboards','whiteboards','whiteboard'],
] as const) {
  app.patch(`/api/${route}${kind === 'settings' ? '' : '/:id'}`, async (req,res) => {
    const routeId = (req.params as Record<string,string>).id;
    const id = kind === 'settings' ? 1 : kind === 'document' ? uuid(routeId) : text(routeId);
    const body = object(req.body);
    const fields = validatePatch(body,kind);
    const values: unknown[] = fields.map(f => f.value);
    values.push(id, body.version);
    const result = await pool.query(`UPDATE ${table} SET ${fields.map((f,i) => `${f.column}=$${i+1}`).join(',')}, version=version+1, updated_at=now() WHERE id=$${values.length-1} AND version=$${values.length} RETURNING *`, values);
    if (!result.rowCount) {
      const current = await pool.query(`SELECT * FROM ${table} WHERE id=$1`,[id]);
      if (!current.rowCount) throw new HttpError(404,'No se encontró el recurso.');
      res.status(409).json({ error: 'El recurso cambió en otra pestaña. Tu borrador sigue conservado.', current: current.rows[0] }); return;
    }
    res.json(result.rows[0]);
  });
}
app.post('/api/connections', async (req,res) => {
  const b = object(req.body);
  const id = uuid(b.id), sourceId = uuid(b.sourceDocId), sourceText = text(b.sourceText,10000), sourceBlock = text(b.sourceBlockId);
  if (b.destinationType !== 'document' && b.destinationType !== 'whiteboard') throw new HttpError(400,'Destino inválido.');
  const destinationId = b.destinationType === 'document' ? uuid(b.destinationId) : text(b.destinationId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const source = await client.query('SELECT id FROM documents WHERE id=$1 AND deleted_at IS NULL FOR SHARE',[sourceId]);
    const destination = await client.query(`SELECT ${b.destinationType === 'document' ? 'title' : 'name'} AS title FROM ${b.destinationType === 'document' ? 'documents' : 'whiteboards'} WHERE id=$1 AND deleted_at IS NULL FOR SHARE`,[destinationId]);
    if (!source.rowCount || !destination.rowCount) throw new HttpError(404,'El origen o destino no está disponible.');
    const path = b.destinationType === 'document' ? `/${destinationId}` : `/pizarra/${destinationId}`;
    const result = await client.query(`INSERT INTO hyperthreads(id,source_doc_id,source_text,source_block_id,destination_type,destination_id,destination_title,destination_path)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING RETURNING *`,[id,sourceId,sourceText,sourceBlock,b.destinationType,destinationId,destination.rows[0].title,path]);
    const saved = result.rows[0] ?? (await client.query('SELECT * FROM hyperthreads WHERE id=$1',[id])).rows[0];
    await client.query('COMMIT'); res.status(201).json(saved);
  } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
});
const errors: ErrorRequestHandler = (error,_req,res,_next) => {
  if (error instanceof HttpError) { res.status(error.status).json({error:error.message}); return; }
  if (error.type === 'entity.too.large') { res.status(413).json({error:'El archivo o contenido supera el límite permitido.'}); return; }
  if (error instanceof SyntaxError) { res.status(400).json({error:'JSON inválido.'}); return; }
  console.error('Error de API:', error.code ?? error.message);
  res.status(500).json({error:'No se pudo completar la operación. Reintenta cuando el servidor esté disponible.'});
};
app.use(errors);
