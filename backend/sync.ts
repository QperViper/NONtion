import { createClient } from '@supabase/supabase-js';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { REMOTE_COLUMNS, TABLES, now, remotePayload } from './fileStorage.ts';
import type { AnyRow, FileStorageService, Fields, TableName } from './fileStorage.ts';

/**
 * Sincronización bidireccional con Supabase (local-first).
 *
 * PUSH — por cada registro local con _dirty:
 *   · no existe en Supabase              → insert (versión 1).
 *   · remoto.version === _base_version   → update condicional (WHERE version = base): nadie lo tocó desde la última vez.
 *   · remoto.version  >  _base_version   → BIFURCACIÓN: otro equipo lo cambió mientras este estaba desconectado.
 *       Páginas, pizarras y eventos: la versión local se guarda como copia nueva «(Conflicto local …)»
 *       y el original se reemplaza por el de la nube. Ajustes: fusión por campo (gana lo que cambiaste aquí).
 *   · borrado definitivo pendiente       → delete condicional; si la nube lo cambió entretanto, se recupera.
 *   El update/delete es condicional en la propia sentencia: si otro equipo escribe entre la lectura y la
 *   escritura, la sentencia no afecta filas y se trata como bifurcación. Nunca se pisa trabajo ajeno.
 *
 * PULL — se compara (id, version) de cada tabla con la base local y se descargan solo las filas nuevas
 *   o con versión mayor que _base_version, sin pisar las que tienen cambios locales. No se usa un corte
 *   por updated_at: los relojes de la torre y el notebook no coinciden y una fecha atrasada haría que un
 *   cambio no se descargara nunca. Comparar versiones es inmune a eso (y detecta los borrados).
 */

// ── Acceso remoto ────────────────────────────────────────────────────────────

export type InsertOutcome = 'ok' | 'exists' | 'missing-reference';
export type UpdateOutcome = 'ok' | 'stale' | 'missing-reference';
export type RemoveOutcome = 'ok' | 'missing' | 'stale';
export interface RemoteVersion { id: string | number; version: number; }

/** Operaciones que la sincronización necesita de la nube (Supabase en producción, memoria en las pruebas). */
export interface RemoteStore {
  versions(table: TableName): Promise<RemoteVersion[]>;
  fetch(table: TableName, ids: (string | number)[]): Promise<Record<string, unknown>[]>;
  version(table: TableName, id: string | number): Promise<number | null>;
  insert(table: TableName, row: Record<string, unknown>): Promise<InsertOutcome>;
  /** Solo actualiza si la versión remota sigue siendo expectedVersion. */
  update(table: TableName, id: string | number, expectedVersion: number, row: Record<string, unknown>): Promise<UpdateOutcome>;
  remove(table: TableName, id: string | number, expectedVersion: number): Promise<RemoveOutcome>;
}

export class RemoteError extends Error {
  constructor(message: string, public code: string, public offline: boolean) { super(message); }
}

const OFFLINE = /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|timeout|aborted|network|socket/i;
function remoteError(error: PostgrestError): RemoteError {
  const detail = `${error.message ?? ''} ${error.details ?? ''}`.trim();
  if (error.code === '42501') return new RemoteError('Supabase rechazó el acceso (RLS). Usa SUPABASE_SECRET_KEY en backend/.env, no la clave pública.', error.code, false);
  return new RemoteError(detail || 'Error de Supabase', error.code ?? '', !error.code && OFFLINE.test(detail));
}

const REQUEST_TIMEOUT = 20_000;
const timeoutFetch: typeof fetch = (input, init = {}) => {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT);
  return fetch(input, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
};

const PAGE = 1000;
const CHUNK = 50;
type Row = Record<string, unknown>;

export class SupabaseRemote implements RemoteStore {
  private client: SupabaseClient;
  constructor(url: string, key: string) {
    this.client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: timeoutFetch },
    });
  }
  private async run<T>(query: PromiseLike<{ data: T | null; error: PostgrestError | null }>): Promise<T | null> {
    let response: { data: T | null; error: PostgrestError | null };
    try { response = await query; } catch (error) {
      const message = (error as Error).message ?? String(error);
      throw new RemoteError(message, '', OFFLINE.test(message) || (error as Error).name === 'TimeoutError');
    }
    if (response.error) throw remoteError(response.error);
    return response.data;
  }
  async versions(table: TableName) {
    const columns = table === 'hyperthreads' ? 'id' : 'id,version';
    const out: RemoteVersion[] = [];
    for (let from = 0; ; from += PAGE) {
      const page = (await this.run(this.client.from(table).select(columns).order('id').range(from, from + PAGE - 1)) ?? []) as unknown as Row[];
      out.push(...page.map(row => ({ id: row.id as string | number, version: table === 'hyperthreads' ? 1 : Number(row.version) })));
      if (page.length < PAGE) return out;
    }
  }
  async fetch(table: TableName, ids: (string | number)[]) {
    const out: Row[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      out.push(...((await this.run(this.client.from(table).select('*').in('id', ids.slice(i, i + CHUNK)))) ?? []) as unknown as Row[]);
    }
    return out;
  }
  async version(table: TableName, id: string | number) {
    const row = (await this.run(this.client.from(table).select(table === 'hyperthreads' ? 'id' : 'id,version').eq('id', id).maybeSingle())) as Row | null;
    if (!row) return null;
    return table === 'hyperthreads' ? 1 : Number(row.version);
  }
  async insert(table: TableName, row: Row): Promise<InsertOutcome> {
    try { await this.run(this.client.from(table).insert(row)); return 'ok'; } catch (error) {
      if (error instanceof RemoteError && error.code === '23505') return 'exists';
      if (error instanceof RemoteError && error.code === '23503') return 'missing-reference';
      throw error;
    }
  }
  async update(table: TableName, id: string | number, expectedVersion: number, row: Row): Promise<UpdateOutcome> {
    try {
      const changed = (await this.run(this.client.from(table).update(row).eq('id', id).eq('version', expectedVersion).select('id'))) as unknown as Row[] | null;
      return changed?.length ? 'ok' : 'stale';
    } catch (error) {
      if (error instanceof RemoteError && error.code === '23503') return 'missing-reference';
      throw error;
    }
  }
  async remove(table: TableName, id: string | number, expectedVersion: number): Promise<RemoveOutcome> {
    let query = this.client.from(table).delete().eq('id', id);
    if (table !== 'hyperthreads') query = query.eq('version', expectedVersion);
    const removed = (await this.run(query.select('id'))) as unknown as Row[] | null;
    if (removed?.length) return 'ok';
    return (await this.version(table, id)) === null ? 'missing' : 'stale';
  }
}

/** Supabase según backend/.env, o null si no está configurado (la app funciona solo en local). */
export function remoteFromEnv(): RemoteStore | null {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  return url && key ? new SupabaseRemote(url, key) : null;
}

// ── Servicio de sincronización ───────────────────────────────────────────────

export type SyncState = 'disabled' | 'idle' | 'syncing' | 'offline' | 'error';
export interface SyncConflict {
  table: TableName; id: string;
  /** Id de la copia creada con la versión local (null si no hizo falta copia). */
  copyId: string | null;
  title: string;
  resolution: 'copia' | 'fusion' | 'nube';
}
export interface SyncResult {
  ok: boolean; state: SyncState; pushed: number; pulled: number; removed: number; assets: number;
  conflicts: SyncConflict[]; error: string | null; startedAt: string; finishedAt: string;
}
export interface SyncStatus {
  state: SyncState; running: boolean; pending: number;
  lastSync: string | null; lastError: string | null; lastResult: SyncResult | null;
}
export interface SyncOptions {
  /** Espera tras la última escritura local antes de sincronizar. */
  debounceMs?: number;
  /** Sincronización periódica (para traer lo que se escribe en el otro equipo). 0 = desactivada. */
  intervalMs?: number;
  /** Sube una imagen pendiente a Supabase Storage. */
  uploadAsset?: (name: string) => Promise<boolean>;
  log?: (message: string) => void;
}

/** Título de la copia de conflicto: «<título> (Conflicto local <fecha ISO>)», recortado al largo permitido. */
export function conflictTitle(title: string, max: number, at = new Date()) {
  const suffix = ` (Conflicto local ${at.toISOString()})`;
  return `${title.slice(0, Math.max(0, max - suffix.length))}${suffix}`;
}

const TITLE_FIELD = { documents: ['title', 255], whiteboards: ['name', 255], events: ['title', 200] } as const;
type CopyTable = keyof typeof TITLE_FIELD;
/** Cambios que no justifican una copia si la nube también cambió (no hay contenido que perder). */
const TRIVIAL = new Set(['deleted_at', 'updated_at', 'version', 'is_favorite']);
const PUSH_ORDER: readonly TableName[] = ['documents', 'whiteboards', 'workspace_settings', 'events', 'hyperthreads'];
const PURGE_ORDER = ['events', 'whiteboards', 'documents'] as const;

export class SyncService {
  private state: SyncState;
  private chain: Promise<unknown> = Promise.resolve();
  private waiting: Promise<SyncResult> | null = null;
  private running = false;
  private lastResult: SyncResult | null = null;
  private debounceTimer: NodeJS.Timeout | undefined;
  private intervalTimer: NodeJS.Timeout | undefined;
  private readonly debounceMs: number;
  private readonly intervalMs: number;
  private readonly log: (message: string) => void;
  private readonly onLocalChange = () => this.schedule();

  constructor(private db: FileStorageService, private remote: RemoteStore | null, private options: SyncOptions = {}) {
    this.state = remote ? 'idle' : 'disabled';
    this.debounceMs = options.debounceMs ?? 4000;
    this.intervalMs = options.intervalMs ?? 60_000;
    this.log = options.log ?? (message => console.log(message));
  }

  get enabled() { return this.remote !== null; }

  /** Activa los disparadores: tras cada escritura local (con espera), periódico y uno inmediato. */
  start({ immediate = true } = {}) {
    if (!this.remote) return;
    this.db.on('local-change', this.onLocalChange);
    if (this.intervalMs > 0) { this.intervalTimer = setInterval(() => { void this.sync(); }, this.intervalMs); this.intervalTimer.unref(); }
    if (immediate) void this.sync();
  }

  stop() {
    this.db.off('local-change', this.onLocalChange);
    clearTimeout(this.debounceTimer);
    clearInterval(this.intervalTimer);
  }

  /** Programa una sincronización en segundo plano (se reinicia con cada escritura: espera a que dejes de escribir). */
  schedule(delay = this.debounceMs) {
    if (!this.remote) return;
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => { void this.sync(); }, delay);
    this.debounceTimer.unref();
  }

  status(): SyncStatus {
    return {
      state: this.running ? 'syncing' : this.state, running: this.running, pending: this.db.pendingCount(),
      lastSync: this.db.meta.last_sync, lastError: this.db.meta.last_sync_error, lastResult: this.lastResult,
    };
  }

  /** Sincroniza ahora. Nunca lanza: sin internet devuelve state 'offline' y la app sigue en local. */
  sync(): Promise<SyncResult> {
    // Una ronda que todavía no empezó ya incluirá todo lo pendiente: se comparte.
    if (this.waiting) return this.waiting;
    const run = this.chain.then(() => { this.waiting = null; return this.runOnce(); });
    this.waiting = run;
    this.chain = run.catch(() => {});
    return run;
  }

  private async runOnce(): Promise<SyncResult> {
    const result: SyncResult = { ok: false, state: this.state, pushed: 0, pulled: 0, removed: 0, assets: 0, conflicts: [], error: null, startedAt: now(), finishedAt: '' };
    if (!this.remote) { result.state = 'disabled'; result.finishedAt = now(); return result; }
    clearTimeout(this.debounceTimer);
    this.running = true;
    try {
      await this.push(this.remote, result);
      await this.pull(this.remote, result);
      await this.pushAssets(result);
      result.ok = true;
      this.state = 'idle';
      this.db.setMeta({ last_sync: now(), last_sync_error: null });
      const changes = result.pushed + result.pulled + result.removed + result.assets;
      if (changes || result.conflicts.length) {
        this.log(`Sincronizado con Supabase: ${result.pushed} subidos, ${result.pulled} descargados, ${result.removed} borrados, ${result.assets} imágenes${result.conflicts.length ? `, ${result.conflicts.length} conflicto(s)` : ''}.`);
      }
      for (const conflict of result.conflicts) this.log(`  Conflicto en ${conflict.table}/${conflict.id}: ${conflict.resolution === 'copia' ? `tu versión local quedó en «${conflict.title}»` : conflict.resolution === 'fusion' ? 'ajustes fusionados por campo' : 'se mantuvo la versión de la nube'}.`);
    } catch (error) {
      const offline = error instanceof RemoteError ? error.offline : OFFLINE.test(String((error as Error)?.message));
      const message = offline ? 'Sin conexión con Supabase. Los cambios quedan guardados en este equipo.' : (error as Error).message ?? String(error);
      // Un aviso por corte, no uno por intento.
      if (this.state !== (offline ? 'offline' : 'error') || this.db.meta.last_sync_error !== message) this.log(`Sincronización pendiente: ${message}`);
      this.state = offline ? 'offline' : 'error';
      result.error = message;
      this.db.setMeta({ last_sync_error: message });
    } finally {
      this.running = false;
      result.state = this.state;
      result.finishedAt = now();
      this.lastResult = result;
    }
    // Lo que se escribió durante la ronda (o una copia de conflicto que no alcanzó a subir) va en la siguiente.
    if (result.ok && this.db.pendingCount()) this.schedule();
    return result;
  }

  // ── Push ──

  private async push(remote: RemoteStore, result: SyncResult) {
    for (const table of PUSH_ORDER) {
      const rows = this.db.dirty(table).filter(row => !row._purge);
      if (table === 'documents') rows.sort((a, b) => this.depth(a.id as string) - this.depth(b.id as string));
      for (const row of rows) await this.pushRow(remote, table, row.id, result);
    }
    for (const table of PURGE_ORDER) {
      for (const row of this.db.dirty(table).filter(item => item._purge)) await this.pushPurge(remote, table, row.id as string, result);
    }
  }

  /** Profundidad en el árbol de páginas: los padres se suben antes que sus hijas (clave foránea parent_id). */
  private depth(id: string) {
    let depth = 0;
    const seen = new Set<string>();
    for (let row = this.db.raw('documents', id); row?.parent_id && !seen.has(row.parent_id); row = this.db.raw('documents', row.parent_id)) {
      seen.add(row.parent_id); depth++;
    }
    return depth;
  }

  private async pushRow(remote: RemoteStore, table: TableName, id: string | number, result: SyncResult, retry = true): Promise<void> {
    const row = this.db.raw(table, id);
    if (!row?._dirty || row._purge) return;
    const sentVersion = row.version;
    const remoteVersion = await remote.version(table, id);

    if (remoteVersion === null) {
      // Caso creación nueva (o algo que otro equipo borró definitivamente y aquí se editó: se recupera, no se pierde).
      const outcome = await remote.insert(table, { ...remotePayload(table, row), ...(table === 'hyperthreads' ? {} : { version: 1 }) });
      if (outcome === 'ok') { this.db.markSynced(table, id, sentVersion, 1); result.pushed++; return; }
      if (outcome === 'missing-reference') return this.fixReference(remote, table, row, result, retry);
      return this.pushRow(remote, table, id, result, false); // 'exists': alguien lo insertó a la vez → se reevalúa
    }

    if (table === 'hyperthreads') { this.db.markSynced(table, id, sentVersion, 1); return; } // inmutables

    if (remoteVersion <= row._base_version && row._base_version > 0) {
      // Caso actualización limpia: nadie lo cambió en la nube desde que este equipo lo descargó.
      const nextVersion = Math.max(remoteVersion + 1, row.version);
      const outcome = await remote.update(table, id, remoteVersion, { ...this.changedPayload(table, row), version: nextVersion });
      if (outcome === 'ok') { this.db.markSynced(table, id, sentVersion, nextVersion); result.pushed++; return; }
      if (outcome === 'missing-reference') return this.fixReference(remote, table, row, result, retry);
      // 'stale': otro equipo escribió justo entre la consulta y el update → bifurcación.
    }

    // Caso conflicto (bifurcación): la nube avanzó desde la versión en que se basó este cambio.
    await this.resolveConflict(remote, table, id, result);
  }

  /** Solo los campos cambiados en local (más fecha): lo demás en la nube es idéntico a la base. */
  private changedPayload(table: TableName, row: AnyRow) {
    const full = remotePayload(table, row);
    const fields = row._dirty_fields.filter(field => REMOTE_COLUMNS[table].includes(field) && field !== 'id' && field !== 'version');
    if (!fields.length) { delete full.id; return full; }
    const out: Record<string, unknown> = { updated_at: row.updated_at };
    for (const field of fields) out[field] = full[field];
    return out;
  }

  /** La nube rechazó una referencia (página padre o enlazada que ya no existe allá). */
  private async fixReference(remote: RemoteStore, table: TableName, row: AnyRow, result: SyncResult, retry: boolean) {
    if (table === 'hyperthreads') { this.db.removeConfirmed(table, row.id); return; } // su página de origen se borró en la nube
    if (table === 'documents') this.db.patchFromSync('documents', row.id, { parent_id: null }, { markDirty: true });
    else if (table === 'events') this.db.patchFromSync('events', row.id, { document_id: null }, { markDirty: true });
    else throw new RemoteError(`Supabase rechazó ${table}/${row.id} por una referencia inválida.`, '23503', false);
    if (retry) await this.pushRow(remote, table, row.id, result, false);
  }

  private async resolveConflict(remote: RemoteStore, table: TableName, id: string | number, result: SyncResult) {
    const [remoteRow] = await remote.fetch(table, [id]);
    if (!remoteRow) return; // desapareció entretanto: la próxima ronda lo inserta
    const remoteVersion = Number(remoteRow.version) || 1;
    // A partir de aquí todo es síncrono: se usa el estado local más reciente (incluye lo escrito durante la consulta).
    const local = this.db.raw(table, id);
    if (!local?._dirty) return;

    if (table === 'workspace_settings') return this.mergeSettings(remote, local, remoteRow, remoteVersion, result);
    if (table === 'hyperthreads') return;

    const copyTable = table as CopyTable;
    const changed = (local._dirty_fields.length ? local._dirty_fields : [...REMOTE_COLUMNS[table]])
      .filter(field => !TRIVIAL.has(field) && field !== 'id' && field !== 'created_at' && REMOTE_COLUMNS[table].includes(field));
    const differs = changed.some(field => !isDeepStrictEqual((local as unknown as Row)[field], remoteRow[field]));
    let copyId: string | null = null;
    const [titleField, max] = TITLE_FIELD[copyTable];
    let title = String(remoteRow[titleField] ?? '');
    if (differs) {
      // Regla anti-pérdida: la versión local se conserva como registro nuevo; la de la nube no se toca.
      copyId = randomUUID();
      const fields = this.copyFields(copyTable, local);
      title = conflictTitle(String((local as unknown as Row)[titleField] ?? ''), max);
      (fields as unknown as Row)[titleField] = title;
      this.db.insert(copyTable, copyId, fields as never);
    }
    // Sin copia: se reaplican encima los cambios menores de aquí (papelera, favorito), que no pisan contenido.
    const minor: Row = {};
    if (!copyId) for (const field of ['deleted_at', 'is_favorite']) {
      if (local._dirty_fields.includes(field) && field in remoteRow && !isDeepStrictEqual((local as unknown as Row)[field], remoteRow[field])) minor[field] = (local as unknown as Row)[field];
    }
    this.db.replaceWithRemote(table, remoteRow);
    if (Object.keys(minor).length) this.db.update(table, id, minor as never);
    result.conflicts.push({ table, id: String(id), copyId, title, resolution: copyId ? 'copia' : 'nube' });
    result.pulled++;
    if (copyId) await this.pushRow(remote, table, copyId, result);
  }

  /** Copia de un registro con su contenido local, lista para insertarse con id nuevo. */
  private copyFields(table: CopyTable, local: AnyRow): Fields<CopyTable> {
    const fields: Row = {};
    for (const column of REMOTE_COLUMNS[table]) if (!['id', 'version', 'updated_at', 'deleted_at'].includes(column)) fields[column] = structuredClone((local as unknown as Row)[column]);
    if ('created_at' in fields) fields.created_at = now();
    // Si el padre o la página enlazada ya no existen aquí, la copia queda en la raíz / sin enlace.
    if (table === 'documents' && fields.parent_id && !this.db.raw('documents', fields.parent_id as string)) fields.parent_id = null;
    if (table === 'events' && fields.document_id && !this.db.raw('documents', fields.document_id as string)) fields.document_id = null;
    return fields as unknown as Fields<CopyTable>;
  }

  /** Ajustes: fusión por campo. Lo cambiado en este equipo se aplica sobre la versión de la nube. */
  private async mergeSettings(remote: RemoteStore, local: AnyRow, remoteRow: Row, remoteVersion: number, result: SyncResult) {
    const sentVersion = local.version;
    const fields = local._dirty_fields.filter(field => REMOTE_COLUMNS.workspace_settings.includes(field) && !['id', 'version', 'updated_at'].includes(field));
    const merged: Row = { ...remoteRow, updated_at: now() };
    for (const field of fields) merged[field] = structuredClone((local as unknown as Row)[field]);
    const nextVersion = Math.max(remoteVersion + 1, local.version);
    const outcome = await remote.update('workspace_settings', 1, remoteVersion, { ...remotePayload('workspace_settings', merged), version: nextVersion });
    if (outcome !== 'ok') return; // otro equipo volvió a escribir: se reintenta en la próxima ronda
    result.conflicts.push({ table: 'workspace_settings', id: '1', copyId: null, title: 'Ajustes del espacio', resolution: 'fusion' });
    result.pushed++;
    const current = this.db.raw('workspace_settings', 1);
    if (current && current.version === sentVersion) { this.db.replaceWithRemote('workspace_settings', { ...merged, version: nextVersion }); return; }
    // Se siguió editando durante la subida: se adoptan los campos de la nube que aquí no se tocaron.
    const untouched: Row = {};
    for (const field of REMOTE_COLUMNS.workspace_settings) if (!current?._dirty_fields.includes(field) && !['id', 'version'].includes(field)) untouched[field] = merged[field];
    this.db.patchFromSync('workspace_settings', 1, untouched as never, { markDirty: false });
    this.db.markSynced('workspace_settings', 1, -1, nextVersion);
  }

  /** Caso eliminación definitiva (papelera vencida): se confirma en la nube y recién entonces se purga aquí. */
  private async pushPurge(remote: RemoteStore, table: 'documents' | 'whiteboards' | 'events', id: string, result: SyncResult) {
    const row = this.db.raw(table, id);
    if (!row?._purge) return;
    const outcome = await remote.remove(table, id, row._base_version);
    if (outcome !== 'stale') { this.db.removeConfirmed(table, id); result.removed++; return; }
    // Otro equipo lo restauró o lo editó: no se borra; vuelve la versión de la nube.
    const [remoteRow] = await remote.fetch(table, [id]);
    if (remoteRow) {
      this.db.replaceWithRemote(table, remoteRow);
      result.conflicts.push({ table, id, copyId: null, title: String(remoteRow[TITLE_FIELD[table][0]] ?? ''), resolution: 'nube' });
    }
  }

  // ── Pull ──

  private async pull(remote: RemoteStore, result: SyncResult) {
    const listed = new Map<TableName, RemoteVersion[]>();
    for (const table of TABLES) listed.set(table, await remote.versions(table));
    // Salvaguarda: la fila de ajustes siempre existe en la nube. Si no aparece, la clave no tiene permiso
    // de lectura (p. ej. clave pública con RLS) y la nube «parecería vacía»: no se borra nada local.
    if (!listed.get('workspace_settings')!.length) {
      throw new RemoteError('Supabase no devolvió datos (¿clave sin permisos o tablas sin crear?). No se aplicó ningún cambio local.', 'empty', false);
    }
    const removals: [TableName, string | number][] = [];
    for (const table of TABLES) {
      const remoteRows = listed.get(table)!;
      const seen = new Set(remoteRows.map(row => String(row.id)));
      const wanted = remoteRows.filter(({ id, version }) => {
        const local = this.db.raw(table, id);
        if (!local) return true;
        return !local._dirty && version > local._base_version;
      }).map(row => row.id);
      if (wanted.length) {
        for (const row of await remote.fetch(table, wanted)) if (this.db.applyRemote(table, row)) result.pulled++;
      }
      // Ya no está en la nube (otro equipo la borró definitivamente) y aquí no tiene cambios: se elimina.
      for (const local of this.db.all(table, { includePurged: true })) {
        if (!seen.has(String(local.id)) && !local._dirty && local._base_version > 0) removals.push([table, local.id]);
      }
    }
    // Salvaguarda contra borrados masivos por un error de la nube (proyecto equivocado, tabla vaciada…).
    const synced = TABLES.reduce((sum, table) => sum + this.db.all(table).filter(row => row._base_version > 0).length, 0);
    if (removals.length > 20 && removals.length > synced / 2) {
      throw new RemoteError(`La nube no tiene ${removals.length} de ${synced} registros de este equipo. Por seguridad no se borró nada local; revisa SUPABASE_URL.`, 'mass-delete', false);
    }
    for (const [table, id] of removals) {
      const local = this.db.raw(table, id);
      if (local && !local._dirty) { this.db.removeConfirmed(table, id); result.removed++; }
    }
  }

  // ── Imágenes ──

  private async pushAssets(result: SyncResult) {
    const upload = this.options.uploadAsset;
    if (!upload) return;
    for (const name of [...this.db.meta.pending_assets]) {
      try {
        if (await upload(name)) { await this.db.removePendingAsset(name); result.assets++; }
      } catch (error) {
        const message = (error as Error).message ?? String(error);
        throw new RemoteError(`No se pudo subir la imagen ${name}: ${message}`, '', OFFLINE.test(message));
      }
    }
  }
}
