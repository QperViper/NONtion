import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

/**
 * Persistencia local de nontion: un único archivo JSON (backend/data/local_db.json).
 *
 * - El estado completo vive en memoria: las lecturas son O(1) por id y no tocan el disco.
 * - Cada mutación se guarda de forma ATÓMICA: se escribe local_db.json.tmp (con fsync) y se
 *   reemplaza el original con rename. Un corte de luz deja el archivo anterior o el nuevo, nunca uno a medias.
 * - Las escrituras se agrupan: si llegan diez cambios mientras se escribe, se hace una sola escritura más.
 * - Cada registro lleva los campos de control de la sincronización (version, _base_version, _dirty…).
 */

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface SyncControl {
  /** Versión local: sube con cada cambio (local o descargado). Es la que usa la interfaz para detectar conflictos. */
  version: number;
  /** Versión de Supabase sobre la que se basó la última edición local (0 = nunca estuvo en la nube). */
  _base_version: number;
  /** true = creado o modificado en este equipo y todavía no confirmado en Supabase. */
  _dirty: boolean;
  /** Campos cambiados en local desde la última sincronización (para fusionar ajustes y evitar copias inútiles). */
  _dirty_fields: string[];
  /** Borrado definitivo (papelera vencida) pendiente de confirmar en Supabase. Oculto para la interfaz. */
  _purge?: boolean;
  /** Posición en el registro de cambios local: cursor de GET /api/changes. */
  _seq: number;
  updated_at: string;
  deleted_at: string | null;
}

export interface SettingsRow extends SyncControl {
  id: 1;
  workspace_name: string; theme_color: string; bg_image: string | null; bg_blur: number; bg_bloom: number;
  sidebar_width: number; settings_width: number; is_sidebar_open: boolean;
  avatar_image: string | null; menu_icon_image: string | null;
  customizations: Record<string, unknown>; background_effect: string | null;
}
export interface DocumentRow extends SyncControl {
  id: string; parent_id: string | null; title: string; icon: string | null; cover_image: string | null;
  content: unknown[]; is_favorite: boolean; created_at: string;
}
export interface WhiteboardRow extends SyncControl {
  id: string; name: string; snapshot: Record<string, unknown>;
}
export interface ConnectionRow extends SyncControl {
  id: string; source_doc_id: string | null; source_text: string; source_block_id: string | null;
  destination_type: 'document' | 'whiteboard' | null; destination_id: string | null;
  destination_title: string; destination_path: string; created_at: string;
}
export interface EventRow extends SyncControl {
  id: string; title: string; description: string; emoji: string | null; color: string;
  priority: 'baja' | 'media' | 'alta' | 'urgente'; all_day: boolean; start_at: string; end_at: string;
  completed: boolean; document_id: string | null; created_at: string;
}

export interface Tables {
  workspace_settings: SettingsRow;
  documents: DocumentRow;
  whiteboards: WhiteboardRow;
  hyperthreads: ConnectionRow;
  events: EventRow;
}
export type TableName = keyof Tables;
export type AnyRow = Tables[TableName];
/** Campos propios del registro (sin los de control; deleted_at sí se edita: es la papelera). */
export type Fields<T extends TableName> = Omit<Tables[T], keyof SyncControl | 'id'> & { deleted_at?: string | null };

export const TABLES: readonly TableName[] = ['workspace_settings', 'documents', 'whiteboards', 'events', 'hyperthreads'];

/** Columnas que existen en Supabase. Lo demás (campos con «_») es solo local. */
export const REMOTE_COLUMNS: { readonly [T in TableName]: readonly string[] } = {
  workspace_settings: ['id', 'workspace_name', 'theme_color', 'bg_image', 'bg_blur', 'bg_bloom', 'sidebar_width', 'settings_width',
    'is_sidebar_open', 'avatar_image', 'menu_icon_image', 'customizations', 'background_effect', 'updated_at', 'version'],
  documents: ['id', 'parent_id', 'title', 'icon', 'cover_image', 'content', 'is_favorite', 'created_at', 'updated_at', 'version', 'deleted_at'],
  whiteboards: ['id', 'name', 'snapshot', 'updated_at', 'version', 'deleted_at'],
  // Las conexiones son inmutables en Supabase: sin versión, fecha de cambio ni papelera.
  hyperthreads: ['id', 'source_doc_id', 'source_text', 'source_block_id', 'destination_type', 'destination_id', 'destination_title', 'destination_path', 'created_at'],
  events: ['id', 'title', 'description', 'emoji', 'color', 'priority', 'all_day', 'start_at', 'end_at', 'completed', 'document_id',
    'created_at', 'updated_at', 'version', 'deleted_at'],
};

export interface Meta {
  schema: 1;
  /** Identifica este equipo en los registros. */
  device_id: string;
  /** Último número del registro de cambios local. */
  seq: number;
  /** Última sincronización completa con Supabase (ISO) o null. */
  last_sync: string | null;
  last_sync_error: string | null;
  /** Imágenes guardadas en local que todavía no se subieron a Supabase Storage. */
  pending_assets: string[];
  created_at: string;
  /** De dónde salió el contenido inicial (respaldo diario o Supabase), si se sembró. */
  seeded_from?: string;
}

interface DbFile {
  _meta: Meta;
  workspace_settings: Record<string, SettingsRow>;
  documents: Record<string, DocumentRow>;
  whiteboards: Record<string, WhiteboardRow>;
  hyperthreads: Record<string, ConnectionRow>;
  events: Record<string, EventRow>;
}

export class VersionConflict extends Error {
  constructor(public current: AnyRow) { super('Versión desactualizada'); }
}

// ── Utilidades ───────────────────────────────────────────────────────────────

export const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const key = (id: string | number) => String(id);

export const DEFAULT_SETTINGS: Fields<'workspace_settings'> = {
  workspace_name: 'Espacio de Nicolás', theme_color: '#191919', bg_image: null, bg_blur: 2, bg_bloom: 100,
  sidebar_width: 256, settings_width: 360, is_sidebar_open: true, avatar_image: null, menu_icon_image: null,
  customizations: {}, background_effect: null,
};

/** Copia sin los campos de control: lo que ven la interfaz y la API. */
export function publicRow<T extends AnyRow>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(row)) if (!field.startsWith('_')) out[field] = value;
  return out;
}

/** Solo las columnas que existen en Supabase. */
export function remotePayload(table: TableName, row: AnyRow | Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const source = row as Record<string, unknown>;
  for (const column of REMOTE_COLUMNS[table]) if (column in source) out[column] = source[column];
  return out;
}

const emptyFile = (): DbFile => ({
  _meta: { schema: 1, device_id: randomUUID(), seq: 0, last_sync: null, last_sync_error: null, pending_assets: [], created_at: now() },
  workspace_settings: {}, documents: {}, whiteboards: {}, hyperthreads: {}, events: {},
});

/** En Windows, el antivirus o OneDrive pueden tener el archivo abierto un instante: se reintenta el reemplazo. */
async function replaceFile(from: string, to: string) {
  for (let attempt = 1; ; attempt++) {
    try { await rename(from, to); return; } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 12 || !['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '')) throw error;
      await sleep(25 * attempt);
    }
  }
}

// ── Servicio ─────────────────────────────────────────────────────────────────

export interface StorageEvents { 'local-change': []; 'change': []; }

export class FileStorageService extends EventEmitter<StorageEvents> {
  /** true si al abrir no existía local_db.json (primera vez en este equipo). */
  readonly isNew: boolean;
  private data: DbFile;
  private chain: Promise<void> = Promise.resolve();
  private scheduled: Promise<void> | null = null;

  private constructor(readonly file: string, data: DbFile, isNew: boolean) {
    super();
    this.data = data;
    this.isNew = isNew;
  }

  /** Abre (o crea) el archivo. Si está dañado, lo aparta con otro nombre y empieza desde el temporal o vacío. */
  static async open(file: string): Promise<FileStorageService> {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    const parse = async (target: string) => normalize(JSON.parse(await readFile(target, 'utf8')) as Partial<DbFile>);
    let data: DbFile | null = null;
    let isNew = false;
    let mustWrite = false;
    try {
      data = await parse(file);
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
      if (!missing) {
        const aside = file.replace(/\.json$/, '') + `.danado-${now().replace(/[:.]/g, '-')}.json`;
        console.error(`local_db.json no se pudo leer (${(error as Error).message}). Se apartó como ${path.basename(aside)}.`);
        await replaceFile(file, aside).catch(() => {});
      }
      // Un corte justo entre escribir el temporal y reemplazar deja el temporal completo: se recupera.
      if (existsSync(tmp)) data = await parse(tmp).catch(() => null);
      if (!data) { data = emptyFile(); isNew = missing; }
      mustWrite = true;
    }
    if (!data.workspace_settings['1']) {
      mustWrite = true;
      // Ajustes por defecto «limpios» (versión 0 en la nube): la primera sincronización trae los reales.
      data.workspace_settings['1'] = { id: 1, ...DEFAULT_SETTINGS, version: 1, _base_version: 0, _dirty: false, _dirty_fields: [], _seq: 0, updated_at: now(), deleted_at: null };
    }
    const service = new FileStorageService(file, data, isNew);
    // Un archivo leído sin problemas no se reescribe al abrir (otro proceso podría estar usándolo).
    if (mustWrite) { await service.persist(); await unlink(tmp).catch(() => {}); }
    return service;
  }

  // ── Lectura ──

  get meta(): Readonly<Meta> { return this.data._meta; }
  get seq() { return this.data._meta.seq; }

  /** Registro por id (incluye los marcados para borrado definitivo; usa visible() para la interfaz). */
  raw<T extends TableName>(table: T, id: string | number): Tables[T] | undefined {
    return (this.data[table] as Record<string, Tables[T]>)[key(id)];
  }
  /** Registro visible para la interfaz (oculta los pendientes de borrado definitivo). */
  get<T extends TableName>(table: T, id: string | number): Tables[T] | undefined {
    const row = this.raw(table, id);
    return row && !row._purge ? row : undefined;
  }
  all<T extends TableName>(table: T, { includePurged = false } = {}): Tables[T][] {
    const rows = Object.values(this.data[table] as Record<string, Tables[T]>);
    return includePurged ? rows : rows.filter(row => !row._purge);
  }
  dirty<T extends TableName>(table: T): Tables[T][] {
    return this.all(table, { includePurged: true }).filter(row => row._dirty);
  }
  pendingCount() {
    return TABLES.reduce((sum, table) => sum + this.dirty(table).length, 0) + this.data._meta.pending_assets.length;
  }
  /** Copia de todo el contenido (para respaldos). */
  snapshot(): DbFile { return structuredClone(this.data); }

  // ── Escritura local (la que hace el usuario: marca _dirty y programa la sincronización) ──

  insert<T extends TableName>(table: T, id: string | number, fields: Fields<T>): Tables[T] {
    if (this.raw(table, id)) throw new Error(`Ya existe ${table}/${id}`);
    const row = {
      ...fields, id,
      version: 1, _base_version: 0, _dirty: true, _dirty_fields: Object.keys(fields),
      _seq: this.nextSeq(), updated_at: now(), deleted_at: (fields as { deleted_at?: string | null }).deleted_at ?? null,
    } as unknown as Tables[T];
    (this.data[table] as Record<string, Tables[T]>)[key(id)] = row;
    this.touched(true);
    return row;
  }

  /**
   * Cambio local con control de versión optimista: si expectedVersion no coincide, lanza VersionConflict
   * (la interfaz muestra el aviso de conflicto). La comprobación y la escritura son síncronas: dos
   * peticiones simultáneas con la misma versión nunca confirman ambas.
   */
  update<T extends TableName>(table: T, id: string | number, changes: Partial<Fields<T>>, expectedVersion?: number): Tables[T] {
    const row = this.get(table, id);
    if (!row) throw new Error(`No existe ${table}/${id}`);
    if (expectedVersion !== undefined && row.version !== expectedVersion) throw new VersionConflict(row);
    Object.assign(row, changes);
    row.version += 1;
    row._dirty = true;
    row._dirty_fields = [...new Set([...row._dirty_fields, ...Object.keys(changes)])];
    row.updated_at = now();
    row._seq = this.nextSeq();
    this.touched(true);
    return row;
  }

  /**
   * Borrado definitivo (papelera vencida). Si el registro nunca llegó a Supabase (o no hay sincronización),
   * se elimina ya; si no, queda oculto y marcado hasta que la sincronización confirme el borrado en la nube.
   */
  purge(table: 'documents' | 'whiteboards' | 'events', id: string, { remote }: { remote: boolean }) {
    const row = this.raw(table, id);
    if (!row) return;
    this.cascadeLocal(table, id, { markDirty: remote });
    if (!remote || row._base_version === 0) { this.removeRaw(table, id); this.touched(true); return; }
    row._purge = true; row._dirty = true; row._seq = this.nextSeq();
    this.touched(true);
  }

  // ── Escritura desde la sincronización (no marca _dirty ni vuelve a programar la sincronización) ──

  /** Guarda un registro descargado de Supabase. No pisa un registro con cambios locales pendientes. */
  applyRemote<T extends TableName>(table: T, remote: Record<string, unknown>): boolean {
    const id = remote.id as string | number;
    const current = this.raw(table, id);
    if (current?._dirty) return false;
    this.data[table][key(id)] = this.fromRemote(table, remote, current) as never;
    this.touched(false);
    return true;
  }

  /**
   * Reemplaza el registro local por el remoto aunque tenga cambios (lo usa la resolución de conflictos,
   * después de haber guardado la copia local). La versión local siempre sube, para que la interfaz
   * detecte que el contenido cambió bajo sus pies.
   */
  replaceWithRemote<T extends TableName>(table: T, remote: Record<string, unknown>) {
    const id = remote.id as string | number;
    this.data[table][key(id)] = this.fromRemote(table, remote, this.raw(table, id)) as never;
    this.touched(false);
  }

  /**
   * La subida terminó: el registro quedó en Supabase con remoteVersion. Si mientras tanto el usuario
   * siguió editando (la versión local cambió), queda _dirty con la nueva base para subirse en la próxima ronda.
   */
  markSynced(table: TableName, id: string | number, sentVersion: number, remoteVersion: number) {
    const row = this.raw(table, id);
    if (!row) return;
    row._base_version = remoteVersion;
    if (row.version === sentVersion) {
      row._dirty = false;
      row._dirty_fields = [];
      row.version = Math.max(row.version, remoteVersion);
    }
    this.touched(false);
  }

  /** Cambio pedido por la sincronización (p. ej. quitar una referencia que ya no existe en la nube). */
  patchFromSync<T extends TableName>(table: T, id: string | number, changes: Partial<Fields<T>>, { markDirty }: { markDirty: boolean }) {
    const row = this.raw(table, id);
    if (!row) return;
    Object.assign(row, changes);
    row.version += 1;
    row._seq = this.nextSeq();
    if (markDirty) { row._dirty = true; row._dirty_fields = [...new Set([...row._dirty_fields, ...Object.keys(changes)])]; }
    this.touched(false);
  }

  /** El registro desapareció de Supabase (lo borró otro equipo) o se confirmó su borrado: se elimina aquí. */
  removeConfirmed(table: TableName, id: string | number) {
    if (!this.raw(table, id)) return;
    if (table === 'documents' || table === 'whiteboards' || table === 'events') this.cascadeLocal(table, key(id), { markDirty: false });
    this.removeRaw(table, id);
    this.touched(false);
  }

  setMeta(changes: Partial<Omit<Meta, 'schema' | 'device_id'>>) {
    Object.assign(this.data._meta, changes);
    this.scheduleWrite();
  }
  addPendingAsset(name: string) {
    if (!this.data._meta.pending_assets.includes(name)) this.data._meta.pending_assets.push(name);
    return this.scheduleWrite();
  }
  removePendingAsset(name: string) {
    this.data._meta.pending_assets = this.data._meta.pending_assets.filter(item => item !== name);
    return this.scheduleWrite();
  }

  /**
   * Siembra el archivo con filas de un respaldo (formato database.json de backups/daily). Las filas
   * quedan «limpias» (con su versión de la nube como base): la sincronización solo trae lo más nuevo.
   */
  seed(tables: Partial<Record<TableName, Record<string, unknown>[]>>, source: string) {
    for (const table of TABLES) for (const row of tables[table] ?? []) {
      this.data[table][key(row.id as string | number)] = this.fromRemote(table, row, undefined) as never;
    }
    this.data._meta.seeded_from = source;
    this.touched(false);
  }

  // ── Disco ──

  /** Promesa que se cumple cuando el estado actual ya está en el disco. */
  persist(): Promise<void> { return this.scheduleWrite(); }

  private scheduleWrite(): Promise<void> {
    // Si hay una escritura esperando turno, incluirá este cambio: se reutiliza.
    if (this.scheduled) return this.scheduled;
    const run = this.chain.then(() => { this.scheduled = null; return this.writeNow(); });
    this.scheduled = run;
    this.chain = run.catch(error => { console.error('No se pudo guardar local_db.json:', (error as Error).message); });
    return run;
  }

  private async writeNow() {
    const text = JSON.stringify(this.data); // síncrono: captura el estado exacto de este momento
    const tmp = `${this.file}.tmp`;
    const handle = await open(tmp, 'w');
    try { await handle.writeFile(text, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    await replaceFile(tmp, this.file);
  }

  // ── Internos ──

  private nextSeq() { return ++this.data._meta.seq; }

  private touched(local: boolean) {
    void this.scheduleWrite().catch(() => {});
    this.emit('change');
    if (local) this.emit('local-change');
  }

  private removeRaw(table: TableName, id: string | number) {
    delete (this.data[table] as Record<string, AnyRow>)[key(id)];
    this.nextSeq();
  }

  /** Lo mismo que hacían las claves foráneas de PostgreSQL al borrar definitivamente. */
  private cascadeLocal(table: 'documents' | 'whiteboards' | 'events', id: string, { markDirty }: { markDirty: boolean }) {
    if (table !== 'documents') return;
    for (const child of this.all('documents', { includePurged: true })) {
      if (child.parent_id === id) this.patchFromSync('documents', child.id, { parent_id: null }, { markDirty: markDirty && child._base_version > 0 });
    }
    for (const event of this.all('events', { includePurged: true })) {
      if (event.document_id === id) this.patchFromSync('events', event.id, { document_id: null }, { markDirty: markDirty && event._base_version > 0 });
    }
    for (const connection of this.all('hyperthreads', { includePurged: true })) {
      if (connection.source_doc_id === id) this.removeRaw('hyperthreads', connection.id);
    }
  }

  /** Convierte una fila de Supabase (o de un respaldo) en registro local limpio. */
  private fromRemote<T extends TableName>(table: T, remote: Record<string, unknown>, current: AnyRow | undefined): Tables[T] {
    const fields: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(remote)) if (field !== 'change_xid' && !field.startsWith('_')) fields[field] = value;
    const remoteVersion = table === 'hyperthreads' ? 1 : Number(remote.version) || 1;
    // La versión local nunca baja: así la interfaz siempre nota el cambio.
    const version = current ? Math.max(remoteVersion, current.version + 1) : remoteVersion;
    if (table === 'workspace_settings') fields.id = 1;
    return {
      ...fields,
      version, _base_version: remoteVersion, _dirty: false, _dirty_fields: [], _seq: this.nextSeq(),
      updated_at: (fields.updated_at as string | undefined) ?? (fields.created_at as string | undefined) ?? now(),
      deleted_at: (fields.deleted_at as string | null | undefined) ?? null,
    } as unknown as Tables[T];
  }
}

/** Completa un archivo leído del disco (versiones anteriores o editado a mano). */
function normalize(input: Partial<DbFile>): DbFile {
  const base = emptyFile();
  const data: DbFile = {
    _meta: { ...base._meta, ...(input._meta ?? {}), schema: 1 },
    workspace_settings: input.workspace_settings ?? {}, documents: input.documents ?? {},
    whiteboards: input.whiteboards ?? {}, hyperthreads: input.hyperthreads ?? {}, events: input.events ?? {},
  };
  if (!Array.isArray(data._meta.pending_assets)) data._meta.pending_assets = [];
  for (const table of TABLES) for (const row of Object.values(data[table]) as AnyRow[]) {
    row.version ??= 1;
    row._base_version ??= 0;
    row._dirty ??= row._base_version === 0;
    row._dirty_fields ??= [];
    row._seq ??= 0;
    row.updated_at ??= now();
    row.deleted_at ??= null;
  }
  return data;
}
