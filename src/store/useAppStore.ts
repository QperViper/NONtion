import { create } from 'zustand';
import type { Block } from '@blocknote/core';
import { request, assetUrl } from '../lib/api';
import { draftStorage } from '../lib/drafts';
import type { Draft } from '../lib/drafts';
import { SaveQueue } from '../lib/saveQueue';
import type { SaveState } from '../lib/saveQueue';

export type ResourceKind = 'document' | 'whiteboard';
export interface ResourceRef { kind: ResourceKind; id: string; }
export interface Document {
  id: string; title: string; icon: string | null; coverImage: string | null;
  content: Block[]; isFavorite: boolean; version: number; deletedAt: string | null; parentId: string | null;
}
export interface Whiteboard { id: string; title: string; snapshot: Record<string,unknown>; version: number; deletedAt: string | null; }
export interface Hiperhilo {
  id: string; sourceDocId: string | null; sourceBlockId: string | null; sourceText: string;
  destinationTitle: string; destinationPath: string; destinationType: ResourceKind | null; destinationId: string | null;
}
export interface ControlStyle {
  emoji?: string; image?: string | null; color?: string; background?: string; size?: number;
  radius?: number; hidden?: boolean; zone?: 'sidebar' | 'toolbar'; order?: number;
}
export interface Settings {
  backgroundEffect: 'vignette-bloom' | null;
  themeColor: string; bgImage: string | null; bgBlur: number; bgBloom: number; sidebarWidth: number;
  settingsWidth: number; isSidebarOpen: boolean; avatarImage: string | null; menuIconImage: string | null;
  customizations: Record<string,ControlStyle>;
}
interface PendingConnection { sourceDocId: string; sourceBlockId: string; text: string; apply: (url: string) => void; }
type Row = Record<string,unknown>;
interface Bootstrap { settings: Row; documents: Row[]; whiteboards: Row[]; connections: Row[]; }
interface AppState extends Settings {
  isLoaded: boolean; loading: boolean; loadError: string | null; error: string | null;
  settingsVersion: number; documents: Document[]; whiteboards: Whiteboard[]; connections: Hiperhilo[];
  currentDocId: string | null; saveStates: Record<string,SaveState>; generations: Record<string,number>;
  orphanDrafts: Draft[]; panels: ResourceRef[]; replaceTarget: ResourceRef | null;
  isSearchOpen: boolean; pendingConnection: PendingConnection | null;
  isCustomizing: boolean; editingControl: string | null; pauseAnimations: boolean;
  fetchInitialData: () => Promise<void>; refresh: () => Promise<void>;
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
function documentRow(d: Row): Document {
  return {id:String(d.id),title:String(d.title),icon:d.icon as string|null,coverImage:d.cover_image as string|null,content:(d.content || []) as Block[],isFavorite:Boolean(d.is_favorite),version:Number(d.version),deletedAt:d.deleted_at as string|null,parentId:d.parent_id as string|null};
}
function boardRow(d: Row): Whiteboard {
  return {id:String(d.id),title:String(d.name),snapshot:(d.snapshot || {}) as Row,version:Number(d.version),deletedAt:d.deleted_at as string|null};
}
function connectionRow(c: Row): Hiperhilo {
  return {id:String(c.id),sourceDocId:c.source_doc_id as string|null,sourceBlockId:c.source_block_id as string|null,sourceText:String(c.source_text),destinationTitle:String(c.destination_title),destinationPath:String(c.destination_path),destinationType:c.destination_type as ResourceKind|null,destinationId:c.destination_id as string|null};
}
function settingsRow(s: Row): Settings {
  return {backgroundEffect:s.background_effect === 'vignette-bloom' ? 'vignette-bloom' : null,themeColor:String(s.theme_color),bgImage:s.bg_image as string|null,bgBlur:Number(s.bg_blur),bgBloom:Number(s.bg_bloom),sidebarWidth:Number(s.sidebar_width),settingsWidth:Number(s.settings_width),isSidebarOpen:Boolean(s.is_sidebar_open),avatarImage:s.avatar_image as string|null,menuIconImage:s.menu_icon_image as string|null,customizations:(s.customizations || {}) as Settings['customizations']};
}
export const resourceKey = (ref: ResourceRef) => `${ref.kind}:${ref.id}`;
export const resourcePath = (ref: ResourceRef) => ref.kind === 'document' ? `/${ref.id}` : `/pizarra/${ref.id}`;
let tabId = sessionStorage.getItem('nontion-tab');
if (!tabId) { tabId = crypto.randomUUID(); sessionStorage.setItem('nontion-tab',tabId); }
const namespace = `${tabId}|`;
let bootstrapPromise: Promise<void> | null = null;
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
    if (kind === 'document') useAppStore.setState(s => ({documents:s.documents.map(d => d.id === id ? {...d,...patch} as Document : d)}));
    else useAppStore.setState(s => ({whiteboards:s.whiteboards.map(d => d.id === id ? {...d,...patch} as Whiteboard : d)}));
  }
}
function applySaved(key: string, row: Row) {
  const pending = queue.pending().find(d => d.key === key)?.patch || {};
  if (key === 'settings:1') useAppStore.setState({...settingsRow(row),...pending,settingsVersion:Number(row.version)});
  else {
    const data = key.startsWith('document:') ? documentRow(row) : boardRow(row);
    if (key.startsWith('document:') && !useAppStore.getState().documents.some(d=>d.id===data.id)) useAppStore.setState(s=>({documents:[...s.documents,data as Document]}));
    if (key.startsWith('whiteboard:') && !useAppStore.getState().whiteboards.some(d=>d.id===data.id)) useAppStore.setState(s=>({whiteboards:[...s.whiteboards,data as Whiteboard]}));
    applyPatch(key,{...data,...pending});
  }
}
function editResource(kind: ResourceKind,id: string,patch: Row) {
  const s = useAppStore.getState();
  const resource = (kind === 'document' ? s.documents : s.whiteboards).find(d => d.id === id);
  if (!resource) return;
  const key = resourceKey({kind,id}); applyPatch(key,patch);
  void queue.enqueue(key,resource.version,patch);
}
export const useAppStore = create<AppState>((set,get) => ({
  ...defaults,isLoaded:false,loading:false,loadError:null,error:null,settingsVersion:1,
  documents:[],whiteboards:[],connections:[],currentDocId:null,saveStates:{},generations:{},orphanDrafts:[],panels:[],replaceTarget:null,
  isSearchOpen:false,pendingConnection:null,isCustomizing:false,editingControl:null,pauseAnimations:localStorage.getItem('nontion-pause-animations') === 'true' || (localStorage.getItem('nontion-pause-animations') === null && window.matchMedia('(prefers-reduced-motion: reduce)').matches),
  setError:error => set({error}),
  fetchInitialData: () => {
    if (bootstrapPromise) return bootstrapPromise;
    if (get().isLoaded) return Promise.resolve();
    set({loading:true,loadError:null});
    bootstrapPromise = (async () => {
      try {
        const data = await request<Bootstrap>('/bootstrap');
        set({...settingsRow(data.settings),settingsVersion:Number(data.settings.version),documents:data.documents.map(documentRow),whiteboards:data.whiteboards.map(boardRow),connections:data.connections.map(connectionRow)});
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
  refresh: async () => {
    if (!get().isLoaded) return;
    try {
      const data = await request<Bootstrap>('/bootstrap');
      const generations = {...get().generations};
      const documents = data.documents.map(row => {
        const key = `document:${row.id}`, current = get().documents.find(d => d.id === row.id);
        if (queue.has(key)) return current || documentRow(row);
        if (current && current.version !== Number(row.version)) generations[key] = (generations[key] || 0)+1;
        return documentRow(row);
      });
      const whiteboards = data.whiteboards.map(row => {
        const key = `whiteboard:${row.id}`, current = get().whiteboards.find(d => d.id === row.id);
        if (queue.has(key)) return current || boardRow(row);
        if (current && current.version !== Number(row.version)) generations[key] = (generations[key] || 0)+1;
        return boardRow(row);
      });
      set({documents,whiteboards,connections:data.connections.map(connectionRow),generations,...(!queue.has('settings:1') ? {...settingsRow(data.settings),settingsVersion:Number(data.settings.version)} : {})});
    } catch { /* Pending writes remain visible; a background refresh never clears local state. */ }
  },
  retrySaves:() => queue.retry(),
  resolveConflict: async (key,keepLocal) => {
    const remote = get().saveStates[key]?.remote;
    if (!remote) return;
    try {
      if (keepLocal) applySaved(key,remote);
      await queue.resolve(key,remote,keepLocal);
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
  setSidebarWidth:value => { void get().syncSettings({sidebarWidth:Math.max(180,Math.min(600,value))}); },
  setSettingsWidth:value => { void get().syncSettings({settingsWidth:Math.max(300,Math.min(700,value))}); },
  toggleSidebar:() => { void get().syncSettings({isSidebarOpen:!get().isSidebarOpen}); },
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
  setPauseAnimations:pauseAnimations => { localStorage.setItem('nontion-pause-animations',String(pauseAnimations)); set({pauseAnimations}); },
}));
if (typeof window !== 'undefined') {
  const online=() => queue.retry();
  const focus=() => { void useAppStore.getState().refresh(); };
  const beforeUnload=(event:BeforeUnloadEvent) => {
    if (queue.pending().length) { event.preventDefault(); event.returnValue = ''; }
  };
  window.addEventListener('online',online);
  window.addEventListener('focus',focus);
  window.addEventListener('beforeunload',beforeUnload);
  import.meta.hot?.dispose(()=>{
    queue.stop();window.removeEventListener('online',online);window.removeEventListener('focus',focus);window.removeEventListener('beforeunload',beforeUnload);
  });
}
