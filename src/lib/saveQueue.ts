import type { Draft, DraftStorage } from './drafts.ts';

export type SaveStatus = 'pending' | 'saving' | 'saved' | 'error' | 'conflict';
export interface SaveState { status: SaveStatus; message?: string; remote?: Record<string,unknown>; }
interface Entry extends Draft { inFlight?: boolean; blocked?: boolean; remote?: Record<string,unknown>; timer?: ReturnType<typeof setTimeout>; }
export class SaveQueue {
  private entries = new Map<string,Entry>();
  private storageChain: Promise<unknown> = Promise.resolve();
  private storage: DraftStorage;
  private send: (draft: Draft) => Promise<Record<string,unknown>>;
  private notify: (key: string, state: SaveState, saved?: Record<string,unknown>) => void;
  private namespace: string;
  constructor(storage: DraftStorage, send: (draft: Draft) => Promise<Record<string,unknown>>,
    notify: (key: string, state: SaveState, saved?: Record<string,unknown>) => void, namespace = '') {
    this.storage=storage;this.send=send;this.notify=notify;this.namespace=namespace;
  }
  private persist(entry: Entry) {
    const copy: Draft = {key: this.namespace + entry.key,version:entry.version,patch:structuredClone(entry.patch)};
    const task = this.storageChain.catch(() => {}).then(() => this.storage.put(copy));
    this.storageChain = task;
    return task;
  }
  private remove(key: string) {
    const task = this.storageChain.catch(() => {}).then(() => this.storage.remove(this.namespace + key));
    this.storageChain = task;
    return task;
  }
  has(key: string) { return this.entries.has(key); }
  pending() { return [...this.entries.values()].map(({key,version,patch}) => ({key,version,patch})); }
  async enqueue(key: string, version: number, patch: Record<string,unknown>) {
    const entry = this.entries.get(key) ?? {key,version,patch:{}};
    entry.patch = {...entry.patch,...patch};
    this.entries.set(key,entry);
    if (entry.timer) clearTimeout(entry.timer);
    if (!entry.blocked) this.notify(key,{status:'pending'});
    let persisted = true;
    try { await this.persist(entry); }
    catch { persisted = false; this.notify(key,{status:entry.blocked?'conflict':'error',remote:entry.remote,message:'No se pudo respaldar el borrador. Mantén esta pestaña abierta.'}); }
    if (!entry.blocked) entry.timer = setTimeout(() => { void this.flush(key); },600);
    return persisted;
  }
  recover(draft: Draft, remoteVersion: number, remote: Record<string,unknown>) {
    const entry: Entry = {...draft,blocked:draft.version !== remoteVersion,remote};
    this.entries.set(draft.key,entry);
    this.notify(draft.key,entry.blocked ? {status:'conflict',message:'Hay un borrador recuperado y otra versión guardada.',remote} : {status:'pending'});
  }
  async flush(key: string) {
    const entry = this.entries.get(key);
    if (!entry || entry.inFlight || entry.blocked) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.inFlight = true;
    const sent = {...entry.patch};
    let acknowledged: Record<string,unknown> | undefined;
    this.notify(key,{status:'saving'});
    try {
      const saved = await this.send({key,version:entry.version,patch:sent});
      acknowledged = saved;
      entry.version = Number(saved.version);
      for (const field of Object.keys(sent)) if (entry.patch[field] === sent[field]) delete entry.patch[field];
      if (Object.keys(entry.patch).length) {
        await this.persist(entry);
        this.notify(key,{status:'pending'},saved);
      } else {
        // Persist the acknowledgement before dropping the in-memory entry.
        await this.remove(key);
        if (Object.keys(entry.patch).length) await this.persist(entry);
        else this.entries.delete(key);
        this.notify(key,{status:this.entries.has(key) ? 'pending' : 'saved'},saved);
      }
    } catch (error) {
      if (acknowledged) {
        const pending=Object.keys(entry.patch).length>0;
        if(!pending)this.entries.delete(key);
        this.notify(key,{status:pending?'error':'saved',message:pending?'La última escritura llegó al servidor, pero no se pudo respaldar el cambio siguiente. Mantén esta pestaña abierta.':undefined},acknowledged);
        return;
      }
      const e = error as {status?:number;message?:string;current?:Record<string,unknown>};
      entry.blocked = e.status === 409;
      entry.remote = e.current;
      this.notify(key,{status:entry.blocked?'conflict':'error',message:e.message || 'Servidor sin conexión. Borrador pendiente.',remote:e.current});
    } finally {
      entry.inFlight = false;
      if (this.entries.has(key) && !entry.blocked) entry.timer = setTimeout(() => { void this.flush(key); },5000);
    }
  }
  async resolve(key: string, remote: Record<string,unknown>, keepLocal: boolean) {
    const entry = this.entries.get(key);
    if (!entry || entry.inFlight) return;
    if (keepLocal) {
      entry.version = Number(remote.version); entry.blocked = false;
      await this.persist(entry); await this.flush(key);
    } else {
      if (entry.timer) clearTimeout(entry.timer);
      await this.remove(key); this.entries.delete(key);
      this.notify(key,{status:'saved'},remote);
    }
  }
  retry() { for (const key of this.entries.keys()) void this.flush(key); }
  stop() { for (const entry of this.entries.values()) if (entry.timer) clearTimeout(entry.timer); }
}
