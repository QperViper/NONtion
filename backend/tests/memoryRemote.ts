// Imitación en memoria de las tablas de Supabase para probar la sincronización entre dos equipos.
// Respeta lo que importa: versiones, update/delete condicionales, claves primarias y foráneas.
import { RemoteError } from '../sync.ts';
import type { InsertOutcome, RemoteStore, RemoteVersion, RemoveOutcome, UpdateOutcome } from '../sync.ts';
import type { TableName } from '../fileStorage.ts';

type Row = Record<string, unknown>;

export class MemoryRemote implements RemoteStore {
  tables: Record<TableName, Map<string, Row>> = {
    workspace_settings: new Map(), documents: new Map(), whiteboards: new Map(), hyperthreads: new Map(), events: new Map(),
  };
  /** Simula estar sin internet. */
  offline = false;
  /** Se ejecuta justo antes de cada update (para simular otro equipo escribiendo en ese instante). */
  beforeUpdate: ((table: TableName, id: string) => void) | null = null;

  constructor() {
    this.tables.workspace_settings.set('1', { id: 1, workspace_name: 'Espacio', theme_color: '#191919', bg_blur: 2, bg_bloom: 100, sidebar_width: 256,
      settings_width: 360, is_sidebar_open: true, customizations: {}, background_effect: null, bg_image: null, avatar_image: null, menu_icon_image: null,
      version: 1, updated_at: new Date().toISOString(), change_xid: '1' });
  }
  private check() { if (this.offline) throw new RemoteError('TypeError: fetch failed', '', true); }
  private fk(table: TableName, row: Row) {
    if (table === 'documents' && row.parent_id && !this.tables.documents.has(String(row.parent_id))) return false;
    if (table === 'events' && row.document_id && !this.tables.documents.has(String(row.document_id))) return false;
    if (table === 'hyperthreads' && row.source_doc_id && !this.tables.documents.has(String(row.source_doc_id))) return false;
    return true;
  }
  async versions(table: TableName): Promise<RemoteVersion[]> {
    this.check();
    return [...this.tables[table].values()].map(row => ({ id: row.id as string, version: table === 'hyperthreads' ? 1 : Number(row.version) }));
  }
  async fetch(table: TableName, ids: (string | number)[]) {
    this.check();
    return ids.map(id => this.tables[table].get(String(id))).filter((row): row is Row => Boolean(row)).map(row => structuredClone(row));
  }
  async version(table: TableName, id: string | number) {
    this.check();
    const row = this.tables[table].get(String(id));
    return row ? (table === 'hyperthreads' ? 1 : Number(row.version)) : null;
  }
  async insert(table: TableName, row: Row): Promise<InsertOutcome> {
    this.check();
    if (this.tables[table].has(String(row.id))) return 'exists';
    if (!this.fk(table, row)) return 'missing-reference';
    this.tables[table].set(String(row.id), structuredClone(row));
    return 'ok';
  }
  async update(table: TableName, id: string | number, expectedVersion: number, row: Row): Promise<UpdateOutcome> {
    this.check();
    this.beforeUpdate?.(table, String(id));
    const current = this.tables[table].get(String(id));
    if (!current || Number(current.version) !== expectedVersion) return 'stale';
    const next = { ...current, ...structuredClone(row) };
    if (!this.fk(table, next)) return 'missing-reference';
    this.tables[table].set(String(id), next);
    return 'ok';
  }
  async remove(table: TableName, id: string | number, expectedVersion: number): Promise<RemoveOutcome> {
    this.check();
    const current = this.tables[table].get(String(id));
    if (!current) return 'missing';
    if (table !== 'hyperthreads' && Number(current.version) !== expectedVersion) return 'stale';
    this.tables[table].delete(String(id));
    if (table === 'documents') this.cascade(String(id));
    return 'ok';
  }
  /** Lo que hacen las claves foráneas de Supabase al borrar una página. */
  cascade(id: string) {
    for (const doc of this.tables.documents.values()) if (doc.parent_id === id) doc.parent_id = null;
    for (const event of this.tables.events.values()) if (event.document_id === id) event.document_id = null;
    for (const [key, thread] of this.tables.hyperthreads) if (thread.source_doc_id === id) this.tables.hyperthreads.delete(key);
  }
  /** Escritura directa «desde otro equipo» con el mismo contrato de versión. */
  editAsOtherDevice(table: TableName, id: string, changes: Row) {
    const current = this.tables[table].get(id)!;
    this.tables[table].set(id, { ...current, ...changes, version: Number(current.version) + 1, updated_at: new Date().toISOString() });
  }
}
