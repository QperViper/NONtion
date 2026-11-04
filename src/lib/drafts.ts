export interface Draft {
  key: string;
  version: number;
  patch: Record<string, unknown>;
}
export interface DraftStorage {
  put(draft: Draft): Promise<void>;
  remove(key: string): Promise<void>;
  all(): Promise<Draft[]>;
}
let database: Promise<IDBDatabase> | undefined;
function open() {
  return database ??= new Promise<IDBDatabase>((resolve,reject) => {
    const req = indexedDB.open('nontion-drafts',1);
    req.onupgradeneeded = () => req.result.createObjectStore('drafts', { keyPath:'key' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { database = undefined; reject(req.error); };
  });
}
async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  return new Promise((resolve,reject) => {
    const tx = db.transaction('drafts',mode);
    const req = operation(tx.objectStore('drafts'));
    tx.oncomplete = () => resolve(req.result as T);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export const draftStorage: DraftStorage = {
  put: draft => transaction('readwrite', store => store.put(draft)),
  remove: key => transaction('readwrite', store => store.delete(key)),
  all: () => transaction('readonly', store => store.getAll()),
};
