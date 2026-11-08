import { create } from 'zustand';
import { request, assetUrl } from '../lib/api';
import { draftStorage } from '../lib/drafts';
import type { Draft } from '../lib/drafts';
import { SaveQueue } from '../lib/saveQueue';
import type { SaveState } from '../lib/saveQueue';

import { boardRow, connectionRow, documentRow, mergeBoard, mergeDocument, patchDocument, readDevicePrefs, serverDevicePrefs, sharedSettings, writeDevicePrefs } from '../lib/resources';
import type { ControlStyle, DevicePrefs, Document, Hiperhilo, ResourceKind, ResourceRef, Row, Settings, Whiteboard } from '../lib/resources';
export type { ControlStyle, Document, Hiperhilo, ResourceKind, ResourceRef, Settings, Whiteboard } from '../lib/resources';
interface PendingConnection { sourceDocId: string; sourceBlockId: string; text: string; apply: (url: string) => void; }
interface Bootstrap { cursor: string; settings: Row; documents: Row[]; whiteboards: Row[]; connections: Row[]; }
interface Changes extends Omit<Bootstrap,'settings'> { settings: Row | null; }
interface AppState extends Settings {
  isLoaded: boolean; loading: boolean; loadError: string | null; error: string | null;
  settingsVersion: number; documents: Document[]; whiteboards: Whiteboard[]; connections: Hiperhilo[];
  currentDocId: string | null; saveStates: Record<string,SaveState>; generations: Record<string,number>;
  orphanDrafts: Draft[]; panels: ResourceRef[]; replaceTarget: ResourceRef | null;
  loadErrors: Record<string,string>;
  isSearchOpen: boolean; pendingConnection: PendingConnection | null;
  isCustomizing: boolean; editingControl: string | null; pauseAnimations: boolean;
  /** Pizarra a pantalla completa (preferencia de este equipo, pensada para la tablet). */
  boardFocus: boolean; setBoardFocus: (value: boolean) => void;
  fetchInitialData: () => Promise<void>; refresh: () => Promise<void>;
  loadResource: (ref: ResourceRef) => Promise<void>;
  setError: (error: string | null) => void; retrySaves: () => void;
  resolveConflict: (key: string, keepLocal: boolean) => Promise<void>;
  recoverDraft: (draft: Draft) => Promise<void>;
  discardDraft: (draft: Draft) => Promise<void>;
  setThemeColor: (color: string) => void; setBgImage: (url: string | null) => void;
  setBackgroundEffect: (effect: Settings['backgroundEffect']) => void;
  setBgBlur: (value: number) => void; setBgBloom: (value: number) => void;
  setSidebarWidth: (value: number) => void; setSettingsWidth: (value: number) => void;
  toggleSidebar: () => void; setAvatarImage: (url: string | null) => void; setMenuIconImage: (url: string | null) => void;
  syncSettings: (patch: Partial<Settings>) => Promise<void>;
  createDocument: () => Promise<string>; createWhiteboard: () => Promise<string>;
  updateDocument: (id: string, patch: Partial<Pick<Document,'title'|'content'|'icon'|'coverImage'|'isFavorite'|'deletedAt'>>) => void;
  updateWhiteboard: (id: string, patch: Partial<Pick<Whiteboard,'title'|'snapshot'|'deletedAt'>>) => void;
  deleteDocument: (id: string) => void; setCurrentDoc: (id: string | null) => void;
  uploadImage: (file: File) => Promise<string>;
  setSearchOpen: (open: boolean) => void; startConnection: (connection: PendingConnection) => void;
  connectTo: (target: ResourceRef) => Promise<void>;
  openBeside: (target: ResourceRef) => void; closePanel: (id: string) => void;
  replacePanel: (id: string) => void; cancelReplace: () => void;
  setCustomizing: (value: boolean) => void; setEditingControl: (id: string | null) => void;
  updateControl: (id: string, patch: ControlStyle | null) => void; setPauseAnimations: (value: boolean) => void;
}
const defaults: Settings = {backgroundEffect:null,themeColor:'#191919',bgImage:null,bgBlur:2,bgBloom:100,sidebarWidth:256,settingsWidth:360,isSidebarOpen:true,avatarImage:null,menuIconImage:null,customizations:{}};
export const resourceKey = (ref: ResourceRef) => `${ref.kind}:${ref.id}`;
export const resourcePath = (ref: ResourceRef) => ref.kind === 'document' ? `/${ref.id}` : `/pizarra/${ref.id}`;
let tabId = sessionStorage.getItem('nontion-tab');
if (!tabId) { tabId = crypto.randomUUID(); sessionStorage.setItem('nontion-tab',tabId); }
const namespace = `${tabId}|`;
let bootstrapPromise: Promise<void> | null = null;
/** Cursor de /api/changes: lo que cambió en otros equipos desde la última consulta. */
let cursor = '';
let refreshing: Promise<void> | null = null;
const loading = new Map<string,Promise<void>>();
const pendingPatch = (key: string) => queue.pending().find(d => d.key === key)?.patch || {};
const queue = new SaveQueue(draftStorage, draft => {
  const [kind,...parts] = draft.key.split(':');
  const endpoint = kind === 'settings' ? '/settings' : `/${kind === 'document' ? 'documents' : 'whiteboards'}/${encodeURIComponent(parts.join(':'))}`;
  return request<Row>(endpoint,{method:'PATCH',body:JSON.stringify({...draft.patch,version:draft.version})});
},(key,state,saved) => {
  useAppStore.setState(s => ({ saveStates:{...s.saveStates,[key]:state} }));
  if (saved) applySaved(key,saved);
},namespace);
function applyPatch(key: string, patch: Row) {
  if (key === 'settings:1') useAppStore.setState(patch);
  else {
    const [kind,...ids] = key.split(':'); const id = ids.join(':');
    if (kind === 'document') useAppStore.setState(s => ({documents:s.documents.map(d => d.id === id ? patchDocument(d,patch) : d)}));
    else useAppStore.setState(s => ({whiteboards:s.whiteboards.map(d => d.id === id ? {...d,...patch} as Whiteboard : d)}));
  }
}
/** Inserta o combina una fila del servidor y vuelve a aplicar encima los cambios aún pendientes de este equipo. */
function upsertRow(key: string, row: Row) {
  if (key.startsWith('document:')) {
    const incoming = documentRow(row);
    useAppStore.setState(s => s.documents.some(d => d.id === incoming.id)
      ? {documents:s.documents.map(d => d.id === incoming.id ? mergeDocument(d,incoming) : d)}
      : {documents:[...s.documents,incoming]});
  } else {
    const incoming = boardRow(row);
    useAppStore.setState(s => s.whiteboards.some(d => d.id === incoming.id)
      ? {whiteboards:s.whiteboards.map(d => d.id === incoming.id ? mergeBoard(d,incoming) : d)}
      : {whiteboards:[...s.whiteboards,incoming]});
  }
  const pending = pendingPatch(key);
  if (Object.keys(pending).length) applyPatch(key,pending);
}
function applySaved(key: string, row: Row) {
  if (key === 'settings:1') useAppStore.setState({...sharedSettings(row),...pendingPatch(key),settingsVersion:Number(row.version)});
  else upsertRow(key,row);
}
function editResource(kind: ResourceKind,id: string,patch: Row) {
  const s = useAppStore.getState();
  const resource = (kind === 'document' ? s.documents : s.whiteboards).find(d => d.id === id);
  if (!resource) return;
  const key = resourceKey({kind,id}); applyPatch(key,patch);
  void queue.enqueue(key,resource.version,patch);
}
function setDevice(patch: Partial<DevicePrefs>) { writeDevicePrefs(patch); useAppStore.setState(patch); }
export const useAppStore = create<AppState>((set,get) => ({
  ...defaults,isLoaded:false,loading:false,loadError:null,error:null,settingsVersion:1,
  documents:[],whiteboards:[],connections:[],loadErrors:{},currentDocId:null,saveStates:{},generations:{},orphanDrafts:[],panels:[],replaceTarget:null,
  isSearchOpen:false,pendingConnection:null,isCustomizing:false,editingControl:null,boardFocus:(() => { try { return localStorage.getItem('nontion-board-focus') === 'true'; } catch { return false; } })(),pauseAnimations:localStorage.getItem('nontion-pause-animations') === 'true' || (localStorage.getItem('nontion-pause-animations') === null && window.matchMedia('(prefers-reduced-motion: reduce)').matches),
  setError:error => set({error}),
  fetchInitialData: () => {
    if (bootstrapPromise) return bootstrapPromise;
    if (get().isLoaded) return Promise.resolve();
    set({loading:true,loadError:null});
    bootstrapPromise = (async () => {
      try {
        const data = await request<Bootstrap>('/bootstrap');
        cursor = data.cursor;
        set({...sharedSettings(data.settings),...serverDevicePrefs(data.settings),...readDevicePrefs(),settingsVersion:Number(data.settings.version),documents:data.documents.map(documentRow),whiteboards:data.whiteboards.map(boardRow),connections:data.connections.map(connectionRow)});
        const drafts = await draftStorage.all().catch(() => { set({error:'El navegador no permite respaldar borradores. Mantén la pestaña abierta si hay cambios pendientes.'}); return []; });
        const orphanDrafts=drafts.filter(d => !d.key.startsWith(namespace));
        for (const draft of drafts.filter(d => d.key.startsWith(namespace))) {
          const key = draft.key.slice(namespace.length);
          const remote = key === 'settings:1' ? data.settings : (key.startsWith('document:') ? data.documents : data.whiteboards).find(r => `${key.split(':')[0]}:${r.id}` === key);
          if (remote) { queue.recover({...draft,key},Number(remote.version),remote); applyPatch(key,draft.patch); }
          else orphanDrafts.push(draft);
        }
        set({isLoaded:true,orphanDrafts});
        queue.retry();
      } catch(e) { set({loadError:(e as Error).message || 'No se pudo cargar el espacio.'}); }
      finally { set({loading:false}); bootstrapPromise = null; }
    })();
    return bootstrapPromise;
  },
  refresh: () => {
    if (!get().isLoaded || !cursor) return Promise.resolve();
    refreshing ??= (async () => {
      try {
        const data = await request<Changes>(`/changes?since=${cursor}`);
        const reload: ResourceRef[] = [];
        const generations = {...get().generations};
        const merge = <T extends Document | Whiteboard>(kind: ResourceKind, list: T[], rows: Row[], toItem: (row: Row) => T, mergeItem: (a: T | undefined, b: T) => T) => {
          const next = [...list];
          for (const row of rows) {
            const incoming = toItem(row), key = `${kind}:${incoming.id}`, index = next.findIndex(d => d.id === incoming.id);
            // Lo pendiente en este equipo manda; un choque real aparece como conflicto al guardar.
            if (queue.has(key)) continue;
            if (index < 0) { next.push(incoming); continue; }
            const current = next[index];
            // Contenido abierto que cambió en otro equipo: se mantiene hasta que llegue la versión nueva.
            if (current.loaded && current.version !== incoming.version) reload.push({kind,id:incoming.id});
            next[index] = mergeItem(current,incoming);
          }
          return next;
        };
        const documents = merge('document',get().documents,data.documents,documentRow,mergeDocument);
        const whiteboards = merge('whiteboard',get().whiteboards,data.whiteboards,boardRow,mergeBoard);
        const connections = [...get().connections];
        for (const row of data.connections.map(connectionRow)) {
          const index = connections.findIndex(c => c.id === row.id);
          if (index < 0) connections.unshift(row); else connections[index] = row;
        }
        const settings = data.settings && !queue.has('settings:1') ? {...sharedSettings(data.settings),settingsVersion:Number(data.settings.version)} : {};
        set({documents,whiteboards,connections,generations,...settings});
        cursor = data.cursor;
        for (const ref of reload) {
          try {
            await get().loadResource(ref);
            set(s => ({generations:{...s.generations,[resourceKey(ref)]:(s.generations[resourceKey(ref)] || 0)+1}}));
          } catch { /* se reintentará en la próxima consulta */ }
        }
      } catch { /* Pending writes remain visible; a background refresh never clears local state. */ }
      finally { refreshing = null; }
    })();
    return refreshing;
  },
  loadResource: ref => {
    const key = resourceKey(ref);
    let task = loading.get(key);
    if (!task) {
      task = (async () => {
        try {
          const row = await request<Row>(`/${ref.kind === 'document' ? 'documents' : 'whiteboards'}/${encodeURIComponent(ref.id)}`);
          upsertRow(key,row);
          set(s => { const loadErrors = {...s.loadErrors}; delete loadErrors[key]; return {loadErrors}; });
        } catch (e) {
          set(s => ({loadErrors:{...s.loadErrors,[key]:(e as Error).message || 'No se pudo abrir este recurso.'}}));
          throw e;
        } finally { loading.delete(key); }
      })();
      loading.set(key,task);
    }
    return task;
  },
  retrySaves:() => queue.retry(),
  resolveConflict: async (key,keepLocal) => {
    const remote = get().saveStates[key]?.remote;
    if (!remote) return;
    try {
      if (keepLocal) applySaved(key,remote);
      await queue.resolve(key,remote,keepLocal);
      // "Usar servidor": si solo había metadatos del servidor, se descarga su contenido completo.
      if (!keepLocal && key !== 'settings:1') {
        const [kind,...ids] = key.split(':');
        await get().loadResource({kind:kind as ResourceKind,id:ids.join(':')});
      }
      set(s => ({generations:{...s.generations,[key]:(s.generations[key] || 0)+1}}));
    } catch(e) { set({error:(e as Error).message}); }
  },
  recoverDraft: async draft => {
    const key = draft.key.slice(draft.key.indexOf('|')+1);
    if (queue.has(key)) { set({error:'Resuelve primero el borrador actual de este recurso.'}); return; }
    const data=await request<Bootstrap>('/bootstrap');
    const resource = key === 'settings:1' ? data.settings : [...data.documents,...data.whiteboards].find(d => key.endsWith(`:${d.id}`));
    if (!resource) { set({error:'Este borrador pertenece a un recurso que ya no está disponible.'}); return; }
    applySaved(key,resource);
    queue.recover({...draft,key},Number(resource.version),resource);
    applyPatch(key,draft.patch);
    if (!await queue.enqueue(key,draft.version,draft.patch)) throw new Error('No se pudo copiar el borrador. El original sigue conservado.');
    await draftStorage.remove(draft.key);
    set(s => ({orphanDrafts:s.orphanDrafts.filter(d => d.key !== draft.key),generations:{...s.generations,[key]:(s.generations[key] || 0)+1}}));
    queue.retry();
  },
  discardDraft:async draft=>{
    try{await draftStorage.remove(draft.key);set(s=>({orphanDrafts:s.orphanDrafts.filter(d=>d.key!==draft.key)}));}
    catch{set({error:'No se pudo descartar el borrador. Su copia sigue conservada.'});}
  },
  syncSettings:async patch => { const version = get().settingsVersion; set(patch); await queue.enqueue('settings:1',version,patch); },
  setThemeColor:themeColor => { void get().syncSettings({themeColor}); },
  setBgImage:bgImage => { void get().syncSettings({bgImage,backgroundEffect:null}); },
  setBackgroundEffect:backgroundEffect => { void get().syncSettings({backgroundEffect}); },
  setBgBlur:bgBlur => { void get().syncSettings({bgBlur}); },
  setBgBloom:bgBloom => { void get().syncSettings({bgBloom}); },
  setSidebarWidth:value => setDevice({sidebarWidth:Math.max(180,Math.min(600,value))}),
  setSettingsWidth:value => setDevice({settingsWidth:Math.max(300,Math.min(700,value))}),
  toggleSidebar:() => setDevice({isSidebarOpen:!get().isSidebarOpen}),
  setAvatarImage:avatarImage => { void get().syncSettings({avatarImage}); },
  setMenuIconImage:menuIconImage => { void get().syncSettings({menuIconImage}); },
  createDocument:async () => {
    try { const doc = documentRow(await request<Row>('/documents',{method:'POST',body:'{}'})); set(s => ({documents:[...s.documents,doc]})); return doc.id; }
    catch(e) { set({error:(e as Error).message}); return ''; }
  },
  createWhiteboard:async () => {
    try { const board = boardRow(await request<Row>('/whiteboards',{method:'POST',body:'{}'})); set(s => ({whiteboards:[...s.whiteboards,board]})); return board.id; }
    catch(e) { set({error:(e as Error).message}); return ''; }
  },
  updateDocument:(id,patch) => editResource('document',id,patch),
  updateWhiteboard:(id,patch) => editResource('whiteboard',id,patch),
  deleteDocument:id => editResource('document',id,{deletedAt:new Date().toISOString()}),
  setCurrentDoc:currentDocId => set({currentDocId}),
  uploadImage:async file => {
    try {
      if (!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type) || file.size > 12*1024*1024) throw new Error('Usa PNG, JPG, WebP o GIF de hasta 12 MB.');
      const result = await request<{url:string}>('/assets',{method:'POST',body:file,headers:{'Content-Type':file.type}});
      return assetUrl(result.url)!;
    } catch(e) { set({error:(e as Error).message}); throw e; }
  },
  setSearchOpen:isSearchOpen => set({isSearchOpen,...(!isSearchOpen ? {pendingConnection:null} : {})}),
  startConnection:pendingConnection => set({pendingConnection,isSearchOpen:true}),
  connectTo:async target => {
    const pending = get().pendingConnection;
    if (!pending) return;
    const id = crypto.randomUUID();
    const row = await request<Row>('/connections',{method:'POST',body:JSON.stringify({id,sourceDocId:pending.sourceDocId,sourceBlockId:pending.sourceBlockId,sourceText:pending.text,destinationType:target.kind,destinationId:target.id})});
    // Persist the stable connection before modifying the editor selection.
    pending.apply(`/hilo/${id}`);
    set(s => ({connections:[connectionRow(row),...s.connections],pendingConnection:null,isSearchOpen:false}));
    get().openBeside(target);
  },
  openBeside:target => set(s => resourcePath(target) === window.location.pathname || s.panels.some(p => p.id === target.id && p.kind === target.kind) ? {} : s.panels.length >= 2 ? {replaceTarget:target} : {panels:[...s.panels,target]}),
  closePanel:id => set(s => ({panels:s.panels.filter(p => p.id !== id)})),
  replacePanel:id => set(s => ({panels:s.replaceTarget ? s.panels.map(p => p.id === id ? s.replaceTarget! : p) : s.panels,replaceTarget:null})),
  cancelReplace:() => set({replaceTarget:null}),
  setCustomizing:isCustomizing => set({isCustomizing,editingControl:null}),
  setEditingControl:editingControl => set({editingControl}),
  updateControl:(id,patch) => {
    const customizations = {...get().customizations};
    if (patch) customizations[id] = {...customizations[id],...patch}; else delete customizations[id];
    void get().syncSettings({customizations});
  },
  setBoardFocus:boardFocus => { try { localStorage.setItem('nontion-board-focus',String(boardFocus)); } catch { /* solo comodidad */ } set({boardFocus}); },
  setPauseAnimations:pauseAnimations => { localStorage.setItem('nontion-pause-animations',String(pauseAnimations)); set({pauseAnimations}); },
}));
if (typeof window !== 'undefined') {
  const online=() => queue.retry();
  const focus=() => { void useAppStore.getState().refresh(); };
  // Cambios hechos en otro equipo: se consultan cada 15 s mientras la ventana está visible.
  const poll=setInterval(() => { if (document.visibilityState === 'visible') void useAppStore.getState().refresh(); },15000);
  const visible=() => { if (document.visibilityState === 'visible') void useAppStore.getState().refresh(); };
  document.addEventListener('visibilitychange',visible);
  const beforeUnload=(event:BeforeUnloadEvent) => {
    if (queue.pending().length) { event.preventDefault(); event.returnValue = ''; }
  };
  window.addEventListener('online',online);
  window.addEventListener('online',focus);
  window.addEventListener('focus',focus);
  window.addEventListener('beforeunload',beforeUnload);
  import.meta.hot?.dispose(()=>{
    queue.stop();clearInterval(poll);document.removeEventListener('visibilitychange',visible);window.removeEventListener('online',focus);window.removeEventListener('online',online);window.removeEventListener('focus',focus);window.removeEventListener('beforeunload',beforeUnload);
  });
}
