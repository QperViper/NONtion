import { pool } from './db.ts';

/**
 * Papelera: lo eliminado hace más de 30 días (NONTION_TRASH_DAYS) se borra definitivamente.
 * Las conexiones de una página borrada se van con ella; las subpáginas y eventos enlazados se conservan.
 * Lo borrado sigue en los respaldos diarios mientras estos existan (14 días).
 */
export const trashDays = () => Math.max(1, Number(process.env.NONTION_TRASH_DAYS || 30));

export async function emptyOldTrash(days = trashDays()) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const count = async (table: string) => (await client.query(`DELETE FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at < now() - make_interval(days => $1)`, [days])).rowCount ?? 0;
    const removed = { events: await count('events'), whiteboards: await count('whiteboards'), documents: await count('documents') };
    await client.query('COMMIT');
    return removed;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

/** Al arrancar (tras un minuto, para no demorar la apertura) y luego cada 12 horas. */
export function scheduleTrashCleanup(): () => void {
  const run = async () => {
    try {
      const removed = await emptyOldTrash();
      const total = removed.documents + removed.whiteboards + removed.events;
      if (total) console.log(`Papelera: se borraron definitivamente ${removed.documents} páginas, ${removed.whiteboards} pizarras y ${removed.events} eventos con más de ${trashDays()} días.`);
    } catch (error) {
      console.error('No se pudo vaciar la papelera antigua:', (error as { code?: string }).code ?? (error as Error).message);
    }
  };
  const first = setTimeout(() => { void run(); }, 60_000);
  const every = setInterval(() => { void run(); }, 12 * 60 * 60_000);
  first.unref(); every.unref();
  return () => { clearTimeout(first); clearInterval(every); };
}
