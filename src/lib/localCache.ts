// Copia local (IndexedDB) para abrir más rápido y trabajar sin conexión. Solo para LEER:
// todo cambio se sigue guardando en Supabase por la cola de guardado. Si el navegador no permite
// IndexedDB, la app funciona igual sin copia local (cada operación falla en silencio).
let database: Promise<IDBDatabase> | undefined;
function open() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('nontion-cache', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { database = undefined; reject(req.error); };
  });
}
async function run<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', mode);
    const req = operation(tx.objectStore('kv'));
    tx.oncomplete = () => resolve(req.result as T);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export const cacheGet = <T>(key: string) => run<T | undefined>('readonly', s => s.get(key)).catch(() => undefined);
export const cachePut = (key: string, value: unknown) => run<void>('readwrite', s => s.put(value, key)).catch(() => {});
export const cacheDelete = (key: string) => run<void>('readwrite', s => s.delete(key)).catch(() => {});
export const cacheKeys = () => run<IDBValidKey[]>('readonly', s => s.getAllKeys()).then(keys => keys.map(String), () => [] as string[]);

/** Clave del contenido de una página o pizarra: «content:document:<id>». */
export const contentKey = (resourceKey: string) => `content:${resourceKey}`;

type Row = Record<string, unknown>;
/** Reemplaza o agrega filas por id (para mantener la copia del espacio al día con /changes y los guardados). */
export function upsertRows(list: Row[], rows: Row[]) {
  const out = [...list];
  for (const row of rows) {
    const index = out.findIndex(r => r.id === row.id);
    if (index < 0) out.push(row); else out[index] = { ...out[index], ...row };
  }
  return out;
}
