import { request } from './api';
import { useAppStore } from '../store/useAppStore';

/** Estado de GET/POST /api/sync (los datos viven en este equipo; Supabase es la copia compartida). */
export interface SyncConflict { table: string; title: string; resolution: 'copia' | 'fusion' | 'nube'; }
export interface SyncStatus {
  state: 'disabled' | 'idle' | 'syncing' | 'offline' | 'error'; running: boolean; pending: number;
  lastSync: string | null; lastError: string | null;
  result?: { ok: boolean; conflicts: SyncConflict[] };
}

export const POLL_MS = 10_000;
/** Atajo: Ctrl+Alt+S (Ctrl+Shift+S ya es «tachado» en el editor). */
export const isSyncShortcut = (e: KeyboardEvent) => (e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && e.code === 'KeyS';

export const STATUS_EVENT = 'nontion:sync-status';
/** Pide una sincronización y trae a la interfaz lo que haya llegado de otros equipos. */
export async function syncNow(): Promise<SyncStatus> {
  window.dispatchEvent(new CustomEvent(STATUS_EVENT, { detail: null }));
  const status = await request<SyncStatus>('/sync', { method: 'POST' });
  window.dispatchEvent(new CustomEvent(STATUS_EVENT, { detail: status }));
  await useAppStore.getState().refresh();
  const conflicts = status.result?.conflicts.filter(c => c.resolution === 'copia') ?? [];
  if (conflicts.length) {
    useAppStore.getState().setError(`Hubo cambios en dos equipos a la vez. Nada se perdió: tu versión local quedó como ${conflicts.map(c => `«${c.title}»`).join(', ')}.`);
  }
  return status;
}

