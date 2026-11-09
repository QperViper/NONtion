import express from 'express';
import type { ErrorRequestHandler } from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { pool } from './db.ts';
import type { PoolClient } from 'pg';
import { HttpError, object, text, uuid, validateEvent, validatePatch } from './validation.ts';
import { assetsDir, cloudAssets, saveAsset, savePreview } from './storage.ts';
import { quickSearch } from './internet.ts';
import { captureDir, captureStatus, resolveCapture, startCapture, stopCapture } from './capture.ts';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

export const app = express();
app.disable('x-powered-by');
app.use(cors({ origin(origin, callback) {
  if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) callback(null, true);
  else callback(new HttpError(403, 'Origen no permitido.'));
} }));
app.use(express.json({ limit: '20mb' }));
/** false mientras la base de datos todavía no conecta (sin internet): las rutas que la usan responden 503 al instante. */
export const database = { ready: true };
const NO_DATABASE = /^\/(health|internet|capture|assets)(\/|$)/;
app.use('/api', (req, res, next) => {
  if (database.ready || NO_DATABASE.test(req.path)) return next();
  res.status(503).json({ error: 'Sin conexión con Supabase. Tus cambios quedan guardados en este equipo y se envían al volver la conexión.' });
});
// Caché local primero; lo que falte se descarga de Supabase Storage (si está configurado).
app.use('/assets', express.static(assetsDir, { immutable: true, maxAge: '1y', setHeaders(res) { res.setHeader('X-Content-Type-Options', 'nosniff'); } }), cloudAssets);
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
  try { await saveAsset(filename, data); }
  catch (error) { console.error('No se pudo guardar la imagen:', (error as Error).message); throw new HttpError(502, 'No se pudo guardar la imagen en la nube. Revisa tu conexión y vuelve a intentarlo.'); }
  res.status(201).json({ url: `/assets/${filename}` });
});
const startedAt = Date.now();
// 503 = la API está en marcha pero sin base de datos (el lanzador abre la app igual, con la copia local).
app.get('/api/health', async (_req,res) => {
  const ok = database.ready && await pool.query('SELECT 1').then(() => true, () => false);
  res.status(ok ? 200 : 503).json({ ok, startedAt });
});
// Metadatos sin el contenido: el contenido de cada página o pizarra se pide al abrirla.
// thread_links permite mostrar conexiones entrantes sin descargar la página de origen.
const DOC_META = `id,parent_id,title,icon,cover_image,is_favorite,created_at,updated_at,version,deleted_at,
  jsonb_path_query_array(content,'strict $.** ? (@.type == "link" && @.href starts with "/hilo/").href') AS thread_links`;
const BOARD_META = 'id,name,updated_at,version,deleted_at';
const xid = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) throw new HttpError(400, 'Cursor inválido.');
  return value;
};
/** Lectura coherente. El cursor es el xmin de esta instantánea: lo que confirme después tendrá change_xid >= cursor. */
async function readWorkspace(client: PoolClient, since: string | null) {
  const where = since ? 'WHERE change_xid >= $1::xid8' : '';
  const params = since ? [since] : [];
  const cursor = (await client.query("SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS cursor")).rows[0].cursor as string;
  const settings = await client.query(`SELECT * FROM workspace_settings WHERE id=1 ${since ? 'AND change_xid >= $1::xid8' : ''}`, params);
  const documents = await client.query(`SELECT ${DOC_META} FROM documents ${where} ORDER BY created_at,id`, params);
  const whiteboards = await client.query(`SELECT ${BOARD_META} FROM whiteboards ${where} ORDER BY updated_at,id`, params);
  const connections = await client.query(`SELECT * FROM hyperthreads ${where} ORDER BY created_at DESC,id`, params);
  // Eventos: al arrancar solo los vigentes; en /changes también los borrados, para que desaparezcan en el otro equipo.
  const events = await client.query(`SELECT * FROM events ${since ? where : 'WHERE deleted_at IS NULL'} ORDER BY start_at,id`, params);
  return { cursor, settings: settings.rows[0] ?? null, documents: documents.rows, whiteboards: whiteboards.rows, connections: connections.rows, events: events.rows };
}
async function readOnly<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
}
app.get('/api/bootstrap', async (_req,res) => { res.json(await readOnly(client => readWorkspace(client, null))); });
app.get('/api/changes', async (req,res) => {
  const since = xid(req.query.since);
  res.setHeader('Cache-Control', 'no-store');
  res.json(await readOnly(client => readWorkspace(client, since)));
});
app.get('/api/documents/:id', async (req,res) => {
  const result = await pool.query('SELECT * FROM documents WHERE id=$1',[uuid(req.params.id)]);
  if (!result.rowCount) throw new HttpError(404,'No se encontró la página.');
  res.json(result.rows[0]);
});
app.get('/api/whiteboards/:id', async (req,res) => {
  const result = await pool.query('SELECT * FROM whiteboards WHERE id=$1',[text(req.params.id)]);
  if (!result.rowCount) throw new HttpError(404,'No se encontró la pizarra.');
  res.json(result.rows[0]);
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
// Vista reducida de una imagen (la genera el navegador la primera vez que la muestra). WebP de hasta 1,5 MB.
app.put('/api/assets/:id/preview', express.raw({ type: 'image/webp', limit: '1500kb' }), async (req,res) => {
  const id = uuid(req.params.id);
  const data = req.body as Buffer;
  // Firma de un archivo WebP: «RIFF....WEBP».
  if (!Buffer.isBuffer(data) || data.length < 12 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WEBP') throw new HttpError(415, 'Se esperaba una imagen WebP.');
  try { res.json({ url: await savePreview(id, data) }); }
  catch (error) { console.error('No se pudo guardar la vista reducida:', (error as Error).message); throw new HttpError(502, 'No se pudo guardar la vista reducida.'); }
});
// Panel «Internet»: respuestas rápidas (las páginas completas se abren en una pestaña de tu navegador).
app.get('/api/internet/search', async (req,res) => { res.json(await quickSearch(req.query.q)); });
// Cámara del celular → carpeta FONion. Estas rutas son de la API local (127.0.0.1); el celular usa otro servidor.
app.get('/api/capture', async (_req,res) => { res.setHeader('Cache-Control','no-store'); res.json(await captureStatus()); });
app.post('/api/capture/start', async (_req,res) => {
  try { await startCapture(); } catch (error) {
    const code = (error as { code?: string }).code;
    throw new HttpError(code === 'EADDRINUSE' ? 409 : 500, code === 'EADDRINUSE' ? 'El puerto de la cámara está ocupado por otro programa.' : 'No se pudo activar la recepción.');
  }
  res.json(await captureStatus());
});
app.post('/api/capture/stop', async (_req,res) => { await stopCapture(); res.json(await captureStatus()); });
app.get('/api/capture/file', (req,res) => {
  const full = resolveCapture(req.query.path);
  if (!full) throw new HttpError(404,'No se encontró el archivo.');
  res.sendFile(full, { headers: { 'X-Content-Type-Options': 'nosniff' } });
});
app.post('/api/capture/open-folder', (_req,res) => {
  mkdirSync(captureDir(), { recursive: true });
  if (process.platform === 'win32') spawn('explorer', [captureDir()], { detached: true, stdio: 'ignore' }).unref();
  res.json({ dir: captureDir() });
});
// El id lo genera la app: si la petición se repite (reintento tras un corte), no se duplica el evento.
app.post('/api/events', async (req,res) => {
  const body = object(req.body);
  const id = uuid(body.id);
  const fields = validateEvent(body, { create: true });
  const inserted = await pool.query(`INSERT INTO events(id,${fields.map(f => f.column).join(',')}) VALUES($1,${fields.map((_f,i) => `$${i+2}`).join(',')}) ON CONFLICT (id) DO NOTHING RETURNING *`, [id, ...fields.map(f => f.value)]);
  if (inserted.rowCount) { res.status(201).json(inserted.rows[0]); return; }
  res.json((await pool.query('SELECT * FROM events WHERE id=$1',[id])).rows[0]);
});
for (const [route, table, kind] of [
  ['settings','workspace_settings','settings'], ['documents','documents','document'], ['whiteboards','whiteboards','whiteboard'], ['events','events','event'],
] as const) {
  app.patch(`/api/${route}${kind === 'settings' ? '' : '/:id'}`, async (req,res) => {
    const routeId = (req.params as Record<string,string>).id;
    const id = kind === 'settings' ? 1 : kind === 'document' || kind === 'event' ? uuid(routeId) : text(routeId);
    const body = object(req.body);
    const fields = validatePatch(body,kind);
    const values: unknown[] = fields.map(f => f.value);
    values.push(id, body.version);
    // La respuesta no repite el contenido recién enviado (puede pesar megas en una pizarra).
    const returning = kind === 'document' ? DOC_META : kind === 'whiteboard' ? BOARD_META : '*';
    const result = await pool.query(`UPDATE ${table} SET ${fields.map((f,i) => `${f.column}=$${i+1}`).join(',')}, version=version+1, updated_at=now() WHERE id=$${values.length-1} AND version=$${values.length} RETURNING ${returning}`, values);
    if (!result.rowCount) {
      const current = await pool.query(`SELECT * FROM ${table} WHERE id=$1`,[id]);
      if (!current.rowCount) throw new HttpError(404,'No se encontró el recurso.');
      res.status(409).json({ error: 'El recurso cambió en otra pestaña o en otro equipo. Tu borrador sigue conservado.', current: current.rows[0] }); return;
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
  // Reglas de la base (por ejemplo, un término anterior al inicio en un cambio parcial) o página enlazada inexistente.
  if (error.code === '23514') { res.status(400).json({error:'Los datos no cumplen las reglas (revisa las fechas).'}); return; }
  if (error.code === '23503') { res.status(400).json({error:'La página enlazada no existe.'}); return; }
  console.error('Error de API:', error.code ?? error.message);
  res.status(500).json({error:'No se pudo completar la operación. Reintenta cuando el servidor esté disponible.'});
};
app.use(errors);
