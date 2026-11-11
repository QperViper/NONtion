import express from 'express';
import type { ErrorRequestHandler, Request } from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { localDb } from './localDb.ts';
import { VersionConflict, now, publicRow } from './fileStorage.ts';
import type { AnyRow, DocumentRow, EventRow, Fields, TableName, WhiteboardRow } from './fileStorage.ts';
import { SyncService, remoteFromEnv } from './sync.ts';
import { HttpError, object, text, uuid, validateEvent, validatePatch } from './validation.ts';
import { assetsDir, cloudAssets, saveAsset, savePreview, uploadPending } from './storage.ts';
import { quickSearch } from './internet.ts';
import { captureDir, captureStatus, resolveCapture, startCapture, stopCapture } from './capture.ts';

/** Sincronización con Supabase (desactivada si backend/.env no tiene SUPABASE_URL y la clave). */
export const sync = new SyncService(localDb, remoteFromEnv(), {
  uploadAsset: uploadPending,
  debounceMs: Number(process.env.NONTION_SYNC_DEBOUNCE_MS || 4000),
  intervalMs: Number(process.env.NONTION_SYNC_INTERVAL_MS ?? 60_000),
});

export const app = express();
app.disable('x-powered-by');
app.use(cors({ origin(origin, callback) {
  if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) callback(null, true);
  else callback(new HttpError(403, 'Origen no permitido.'));
} }));
app.use(express.json({ limit: '20mb' }));

// ── Imágenes: siempre al disco local; a Supabase Storage en el momento o en la próxima sincronización ──
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
  const { uploaded } = await saveAsset(filename, data);
  if (!uploaded) { await localDb.addPendingAsset(filename); sync.schedule(); }
  res.status(201).json({ url: `/assets/${filename}` });
});
// Vista reducida de una imagen (la genera el navegador la primera vez que la muestra). WebP de hasta 1,5 MB.
app.put('/api/assets/:id/preview', express.raw({ type: 'image/webp', limit: '1500kb' }), async (req,res) => {
  const id = uuid(req.params.id);
  const data = req.body as Buffer;
  // Firma de un archivo WebP: «RIFF....WEBP».
  if (!Buffer.isBuffer(data) || data.length < 12 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WEBP') throw new HttpError(415, 'Se esperaba una imagen WebP.');
  const saved = await savePreview(id, data);
  if (!saved.uploaded) { await localDb.addPendingAsset(saved.name); sync.schedule(); }
  res.json({ url: saved.url });
});

// ── Estado y sincronización ──
const startedAt = Date.now();
// Los datos son locales: la API está lista apenas arranca, con o sin internet.
app.get('/api/health', (_req,res) => { res.json({ ok: true, startedAt, sync: sync.status() }); });
app.get('/api/sync', (_req,res) => { res.setHeader('Cache-Control', 'no-store'); res.json(sync.status()); });
/** Sincronización manual (botón de la interfaz, Ctrl+Shift+S o «Sincronizar con Supabase.cmd»). */
app.post('/api/sync', async (_req,res) => {
  const result = await sync.sync();
  res.json({ ...sync.status(), result });
});

// ── Vistas de los registros ──
/** Enlaces «/hilo/…» del contenido, en orden de aparición (lo que antes calculaba jsonb_path_query_array). */
export function threadLinks(content: unknown): string[] {
  const out: string[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) { for (const item of node) visit(item); return; }
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (record.type === 'link' && typeof record.href === 'string' && record.href.startsWith('/hilo/')) out.push(record.href);
    for (const value of Object.values(record)) visit(value);
  };
  visit(content);
  return out;
}
/** Metadatos sin el contenido (el contenido de cada página se pide al abrirla). */
function documentMeta(row: DocumentRow) {
  const { content, ...meta } = publicRow(row);
  return { ...meta, thread_links: threadLinks(content) };
}
function whiteboardMeta(row: WhiteboardRow) {
  const { snapshot: _snapshot, ...meta } = publicRow(row);
  return meta;
}
const byText = (...fields: string[]) => (a: AnyRow, b: AnyRow) => {
  for (const field of fields) {
    const x = String((a as unknown as Record<string, unknown>)[field] ?? ''), y = String((b as unknown as Record<string, unknown>)[field] ?? '');
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
};

/**
 * Espacio completo o solo lo cambiado desde un cursor. El cursor es el número del registro de cambios
 * local. Un cursor mayor que el actual (p. ej. guardado en el navegador cuando se usaba PostgreSQL)
 * se trata como «desde el principio».
 */
function readWorkspace(since: number | null) {
  const seq = localDb.seq;
  const from = since !== null && since <= seq ? since : null;
  const changed = <T extends AnyRow>(rows: T[]) => from === null ? rows : rows.filter(row => row._seq > from);
  const settings = localDb.get('workspace_settings', 1)!;
  return {
    cursor: String(seq),
    settings: from === null || settings._seq > from ? publicRow(settings) : null,
    documents: changed(localDb.all('documents')).sort(byText('created_at', 'id')).map(documentMeta),
    whiteboards: changed(localDb.all('whiteboards')).sort(byText('updated_at', 'id')).map(whiteboardMeta),
    connections: changed(localDb.all('hyperthreads')).sort(byText('created_at', 'id')).reverse().map(publicRow),
    // Al arrancar solo los eventos vigentes; en /changes también los borrados, para que desaparezcan.
    events: (since === null ? localDb.all('events').filter(e => !e.deleted_at) : changed(localDb.all('events'))).sort(byText('start_at', 'id')).map(publicRow),
  };
}
const cursorParam = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) throw new HttpError(400, 'Cursor inválido.');
  return Number(value);
};
app.get('/api/bootstrap', (_req,res) => { res.json(readWorkspace(null)); });
app.get('/api/changes', (req,res) => {
  const since = cursorParam(req.query.since);
  res.setHeader('Cache-Control', 'no-store');
  res.json(readWorkspace(since));
});
app.get('/api/documents/:id', (req,res) => {
  const row = localDb.get('documents', uuid(req.params.id));
  if (!row) throw new HttpError(404,'No se encontró la página.');
  res.json(publicRow(row));
});
app.get('/api/whiteboards/:id', (req,res) => {
  const row = localDb.get('whiteboards', text(req.params.id));
  if (!row) throw new HttpError(404,'No se encontró la pizarra.');
  res.json(publicRow(row));
});

// ── Creación ──
/** Responde cuando el cambio ya está en el disco (la interfaz descarta su borrador al recibir la respuesta). */
const saved = () => localDb.persist();

app.post('/api/documents', async (req,res) => {
  const body = object(req.body);
  const title = body.title === undefined ? 'Sin título' : text(body.title);
  const row = localDb.insert('documents', randomUUID(), {
    parent_id: null, title, icon: null, cover_image: null, content: [], is_favorite: false, created_at: now(),
  });
  await saved();
  res.status(201).json(publicRow(row));
});
app.post('/api/whiteboards', async (req,res) => {
  const body = object(req.body);
  const name = body.title === undefined ? 'Nueva pizarra' : text(body.title);
  const row = localDb.insert('whiteboards', randomUUID(), { name, snapshot: {} });
  await saved();
  res.status(201).json(publicRow(row));
});

type EventFields = Fields<'events'>;
/** Reglas que antes aplicaba PostgreSQL: término ≥ inicio y página enlazada existente. */
function checkEvent(event: Pick<EventFields, 'start_at' | 'end_at' | 'document_id'>) {
  if (Date.parse(event.end_at) < Date.parse(event.start_at)) throw new HttpError(400, 'Los datos no cumplen las reglas (revisa las fechas).');
  if (event.document_id && !localDb.raw('documents', event.document_id)) throw new HttpError(400, 'La página enlazada no existe.');
}
const columns = (fields: { column: string; value: unknown }[]) => Object.fromEntries(fields.map(f => [f.column, f.value]));

// El id lo genera la app: si la petición se repite (reintento tras un corte), no se duplica el evento.
app.post('/api/events', async (req,res) => {
  const body = object(req.body);
  const id = uuid(body.id);
  const values = columns(validateEvent(body, { create: true }));
  const existing = localDb.raw('events', id);
  if (existing) { res.json(publicRow(existing)); return; }
  const fields: EventFields = {
    title: '', description: '', emoji: null, color: '#2383e2', priority: 'media', all_day: false,
    start_at: '', end_at: '', completed: false, document_id: null, created_at: now(), ...values,
  } as EventFields;
  checkEvent(fields);
  const row = localDb.insert('events', id, fields);
  await saved();
  res.status(201).json(publicRow(row));
});

// ── Cambios con control de versión ──
for (const [route, table, kind] of [
  ['settings','workspace_settings','settings'], ['documents','documents','document'], ['whiteboards','whiteboards','whiteboard'], ['events','events','event'],
] as const) {
  app.patch(`/api/${route}${kind === 'settings' ? '' : '/:id'}`, async (req: Request, res) => {
    const routeId = (req.params as Record<string,string>).id;
    const id = kind === 'settings' ? 1 : kind === 'document' || kind === 'event' ? uuid(routeId) : text(routeId);
    const body = object(req.body);
    const changes = columns(validatePatch(body, kind));
    const current = localDb.get(table, id);
    if (!current) throw new HttpError(404,'No se encontró el recurso.');
    if (kind === 'event') checkEvent({ ...(current as EventRow), ...changes } as EventRow);
    let row: AnyRow;
    try { row = localDb.update(table as TableName, id, changes as never, Number(body.version)); }
    catch (error) {
      if (!(error instanceof VersionConflict)) throw error;
      res.status(409).json({ error: 'El recurso cambió en otra pestaña o en otro equipo. Tu borrador sigue conservado.', current: publicRow(error.current) }); return;
    }
    await saved();
    // La respuesta no repite el contenido recién enviado (puede pesar megas en una pizarra).
    res.json(kind === 'document' ? documentMeta(row as DocumentRow) : kind === 'whiteboard' ? whiteboardMeta(row as WhiteboardRow) : publicRow(row));
  });
}

app.post('/api/connections', async (req,res) => {
  const b = object(req.body);
  const id = uuid(b.id), sourceId = uuid(b.sourceDocId), sourceText = text(b.sourceText,10000), sourceBlock = text(b.sourceBlockId);
  if (b.destinationType !== 'document' && b.destinationType !== 'whiteboard') throw new HttpError(400,'Destino inválido.');
  const destinationType = b.destinationType;
  const destinationId = destinationType === 'document' ? uuid(b.destinationId) : text(b.destinationId);
  const existing = localDb.get('hyperthreads', id);
  if (existing) { res.status(201).json(publicRow(existing)); return; }
  const source = localDb.get('documents', sourceId);
  const destination = destinationType === 'document' ? localDb.get('documents', destinationId) : localDb.get('whiteboards', destinationId);
  if (!source || source.deleted_at || !destination || destination.deleted_at) throw new HttpError(404,'El origen o destino no está disponible.');
  const row = localDb.insert('hyperthreads', id, {
    source_doc_id: sourceId, source_text: sourceText, source_block_id: sourceBlock,
    destination_type: destinationType, destination_id: destinationId,
    destination_title: 'title' in destination ? destination.title : destination.name,
    destination_path: destinationType === 'document' ? `/${destinationId}` : `/pizarra/${destinationId}`,
    created_at: now(),
  });
  await saved();
  res.status(201).json(publicRow(row));
});

// ── Panel «Internet» y cámara (sin cambios) ──
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

const errors: ErrorRequestHandler = (error,_req,res,_next) => {
  if (error instanceof HttpError) { res.status(error.status).json({error:error.message}); return; }
  if (error.type === 'entity.too.large') { res.status(413).json({error:'El archivo o contenido supera el límite permitido.'}); return; }
  if (error instanceof SyntaxError) { res.status(400).json({error:'JSON inválido.'}); return; }
  console.error('Error de API:', error.code ?? error.message);
  res.status(500).json({error:'No se pudo completar la operación. Reintenta en un momento.'});
};
app.use(errors);
