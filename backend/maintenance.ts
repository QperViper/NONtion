import { localDb } from './localDb.ts';
import type { FileStorageService } from './fileStorage.ts';

/**
 * Papelera: lo eliminado hace más de 30 días (NONTION_TRASH_DAYS) se borra definitivamente.
 * Las conexiones de una página borrada se van con ella; las subpáginas y eventos enlazados se conservan.
 * Si hay sincronización, el borrado se confirma primero en Supabase (hasta entonces queda oculto);
 * si otro equipo restauró el elemento entretanto, no se borra. Lo borrado sigue en los respaldos diarios.
 */
export const trashDays = () => Math.max(1, Number(process.env.NONTION_TRASH_DAYS || 30));

export function emptyOldTrash(days = trashDays(), { db = localDb, remote = Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)) }: { db?: FileStorageService; remote?: boolean } = {}) {
  const limit = Date.now() - days * 24 * 60 * 60 * 1000;
  const removed = { events: 0, whiteboards: 0, documents: 0 };
  for (const table of ['events', 'whiteboards', 'documents'] as const) {
    for (const row of db.all(table)) {
      if (row.deleted_at && Date.parse(row.deleted_at) < limit) { db.purge(table, row.id, { remote }); removed[table]++; }
    }
  }
  return removed;
}

/** Al arrancar (tras un minuto, para no demorar la apertura) y luego cada 12 horas. */
export function scheduleTrashCleanup(): () => void {
  const run = () => {
    try {
      const removed = emptyOldTrash();
      const total = removed.documents + removed.whiteboards + removed.events;
      if (total) console.log(`Papelera: se borraron definitivamente ${removed.documents} páginas, ${removed.whiteboards} pizarras y ${removed.events} eventos con más de ${trashDays()} días.`);
    } catch (error) {
      console.error('No se pudo vaciar la papelera antigua:', (error as Error).message);
    }
  };
  const first = setTimeout(run, 60_000);
  const every = setInterval(run, 12 * 60 * 60_000);
  first.unref(); every.unref();
  return () => { clearTimeout(first); clearInterval(every); };
}
