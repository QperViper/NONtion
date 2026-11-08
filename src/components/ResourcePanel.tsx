import { Component, lazy, Suspense, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { ImagePlus, SmilePlus, Star, X, ArrowUpRight, Link2, RotateCcw, Maximize2, Minimize2 } from 'lucide-react';
import { useAppStore, resourceKey } from '../store/useAppStore';
import type { ResourceRef } from '../store/useAppStore';
import ControlButton from './ControlButton';
import ImageAsset from './ImageAsset';
import { exportJson } from '../lib/exportJson';

const Workspace=lazy(()=>import('../pages/Workspace'));
const Whiteboard=lazy(()=>import('../pages/Whiteboard'));
class EditorBoundary extends Component<{children:ReactNode},{error:boolean}> {
  state={error:false};
  static getDerivedStateFromError(){return {error:true};}
  render(){return this.state.error?<div role="alert" className="p-8 text-rose-200">No se pudo abrir este contenido. La versión guardada se conserva. Puedes exportar el recurso para revisarlo.</div>:this.props.children;}
}
export default function ResourcePanel({resource,onClose,onNavigate}:{resource:ResourceRef;onClose?:()=>void;onNavigate:(target:ResourceRef)=>void}) {
  const doc=useAppStore(s=>s.documents.find(d=>d.id===resource.id));
  const board=useAppStore(s=>s.whiteboards.find(d=>d.id===resource.id));
  const connections=useAppStore(s=>s.connections);
  const allDocuments=useAppStore(s=>s.documents);
  const generation=useAppStore(s=>s.generations[resourceKey(resource)] || 0);
  const status=useAppStore(s=>s.saveStates[resourceKey(resource)]);
  const loadError=useAppStore(s=>s.loadErrors[resourceKey(resource)]);
  const boardFocus=useAppStore(s=>s.boardFocus);
  const item=resource.kind==='document'?doc:board;
  const needsContent=Boolean(item&&!item.loaded&&!item.deletedAt);
  // El contenido no viene en el arranque: se descarga al abrir la página o pizarra.
  const {kind,id}=resource;
  useEffect(()=>{if(needsContent)useAppStore.getState().loadResource({kind,id}).catch(()=>{});},[needsContent,kind,id]);
  const iconInput=useRef<HTMLInputElement>(null),coverInput=useRef<HTMLInputElement>(null);
  if(!item)return <section className="resource-panel p-8"><h1 className="text-xl mb-2">Recurso no encontrado</h1><p className="text-neutral-400">La dirección no corresponde a una página o pizarra de este espacio.</p>{onClose&&<button className="soft-button mt-4" onClick={onClose}>Cerrar panel</button>}</section>;
  const editTitle=(title:string)=>resource.kind==='document'?useAppStore.getState().updateDocument(item.id,{title}):useAppStore.getState().updateWhiteboard(item.id,{title});
  const liveConnections=connections.filter(c=>!c.sourceBlockId || allDocuments.find(d=>d.id===c.sourceDocId)?.threadLinks.includes(c.id));
  const backlinks=liveConnections.filter(c=>c.destinationId===item.id&&c.destinationType===resource.kind);
  const outbound=liveConnections.filter(c=>resource.kind==='document'&&c.sourceDocId===item.id);
  return <section className={`resource-panel ${resource.kind==='whiteboard'?'board-panel':''}`} data-resource={resourceKey(resource)}>
    <header className="panel-header">
      <span className="text-xs text-neutral-400">{resource.kind==='document'?'PÁGINA':'PIZARRA'}</span>
      <span role="status" className={`save-status ${status?.status==='error'||status?.status==='conflict'?'text-amber-300':''}`}>{({pending:'Pendiente',saving:'Guardando…',saved:'Guardado',error:'Sin sincronizar',conflict:'Conflicto'})[status?.status||'saved']}</span>
      <ControlButton controlId="panel.export" label="Exportar recurso JSON" className="icon-button" icon={<ArrowUpRight size={15}/>} onClick={()=>exportJson(item,`${item.title||'recurso'}.json`)}/>
      {resource.kind==='document'&&doc&&<ControlButton controlId="panel.favorite" label={doc.isFavorite?'Quitar de favoritos':'Añadir a favoritos'} className={`icon-button ${doc.isFavorite?'text-amber-300':''}`} icon={<Star size={15} fill={doc.isFavorite?'currentColor':'none'}/>} onClick={()=>useAppStore.getState().updateDocument(doc.id,{isFavorite:!doc.isFavorite})}/>}
      {resource.kind==='whiteboard'&&!onClose&&<ControlButton controlId="panel.board-focus" label={boardFocus?'Salir de pantalla completa':'Pizarra a pantalla completa'} className="icon-button" icon={boardFocus?<Minimize2 size={15}/>:<Maximize2 size={15}/>} onClick={()=>{
        const next=!boardFocus;useAppStore.getState().setBoardFocus(next);
        // Pantalla completa del navegador cuando se puede (en la app instalada ya lo está).
        if(next&&!document.fullscreenElement)document.documentElement.requestFullscreen?.().catch(()=>{});
        if(!next&&document.fullscreenElement)document.exitFullscreen().catch(()=>{});
      }}/>}
      {onClose&&<ControlButton controlId="panel.close" label="Cerrar panel" className="icon-button" icon={<X size={16}/>} onClick={onClose}/>}
    </header>
    {item.deletedAt?<div className="p-8"><h1 className="text-2xl font-semibold mb-3">{item.title}</h1><p className="text-neutral-400 mb-5">Este recurso está en la papelera. Sus conexiones se conservan.</p><ControlButton controlId="resource.restore" label="Restaurar recurso" className="soft-button" icon={<RotateCcw size={16}/>} onClick={()=>resource.kind==='document'?useAppStore.getState().updateDocument(item.id,{deletedAt:null}):useAppStore.getState().updateWhiteboard(item.id,{deletedAt:null})}>Restaurar</ControlButton></div>:<>
      {resource.kind==='document'&&doc?.coverImage&&<div className="page-cover"><ImageAsset src={doc.coverImage} className="cover-image"/><ControlButton controlId="page.remove-cover" label="Quitar portada" className="icon-button bg-black/60 relative" icon={<X size={15}/>} onClick={()=>useAppStore.getState().updateDocument(doc.id,{coverImage:null})}/></div>}
      <div className={`page-heading ${resource.kind==='whiteboard'?'board-heading':''}`}>
        {resource.kind==='document'&&doc&&<>
          <input ref={iconInput} className="hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={async e=>{const file=e.target.files?.[0];if(file)try{useAppStore.getState().updateDocument(doc.id,{icon:await useAppStore.getState().uploadImage(file)});}catch{/* global error */}e.target.value='';}}/>
          <input ref={coverInput} className="hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={async e=>{const file=e.target.files?.[0];if(file)try{useAppStore.getState().updateDocument(doc.id,{coverImage:await useAppStore.getState().uploadImage(file)});}catch{/* global error */}e.target.value='';}}/>
          {doc.icon&&<div className="flex items-start gap-2 mb-4"><ImageAsset src={doc.icon} alt="Icono de página" className="w-16 h-16 rounded-xl object-cover"/><ControlButton controlId="page.remove-icon" label="Quitar icono de página" className="icon-button" icon={<X size={14}/>} onClick={()=>useAppStore.getState().updateDocument(doc.id,{icon:null})}/></div>}
          <div className="flex gap-2 mb-4"><ControlButton controlId="page.icon" label="Cambiar icono de página" className="quiet-button" icon={<SmilePlus size={14}/>} onClick={()=>iconInput.current?.click()}>{doc.icon?'Cambiar icono':'Añadir icono'}</ControlButton><ControlButton controlId="page.cover" label="Cambiar portada" className="quiet-button" icon={<ImagePlus size={14}/>} onClick={()=>coverInput.current?.click()}>{doc.coverImage?'Cambiar portada':'Añadir portada'}</ControlButton></div>
        </>}
        <input aria-label={resource.kind==='document'?'Título de página':'Nombre de pizarra'} className="page-title" placeholder="Sin título" maxLength={255} value={item.title} onChange={e=>editTitle(e.target.value)}/>
      </div>
      {needsContent?<div className="p-8 text-neutral-400" role="status">{loadError?<>{loadError} <button className="soft-button ml-2" onClick={()=>{useAppStore.getState().loadResource(resource).catch(()=>{});}}>Reintentar</button></>:`Descargando ${resource.kind==='document'?'la página':'la pizarra'}…`}</div>
      :<EditorBoundary key={`${resourceKey(resource)}:${generation}`}><Suspense fallback={<div className="p-8 text-neutral-400">Abriendo {resource.kind==='document'?'editor':'lienzo'}…</div>}>
        {resource.kind==='document'?<Workspace documentId={item.id}/>:<Whiteboard boardId={item.id}/>}
      </Suspense></EditorBoundary>}
    </>}
    {(backlinks.length>0||outbound.length>0)&&<footer className="connections-footer">
      <h2 className="flex items-center gap-2 text-xs text-neutral-400 uppercase tracking-wider mb-3"><Link2 size={14}/>Conexiones</h2>
      {backlinks.map(c=><ControlButton key={c.id} controlId="connection.origin" label={`Volver al origen de ${c.sourceText}`} className="connection-row" onClick={()=>{if(c.sourceDocId){onNavigate({kind:'document',id:c.sourceDocId});setTimeout(()=>{const block=document.querySelector(`[data-resource="document:${c.sourceDocId}"] [data-id="${CSS.escape(c.sourceBlockId||'')}"]`);block?.scrollIntoView({behavior:'smooth',block:'center'});},300);}}}><span className="text-neutral-500">←</span><span>{c.sourceText}</span><span className="ml-auto text-xs text-neutral-500">Origen</span></ControlButton>)}
      {outbound.map(c=>{
        const target=c.destinationType&&c.destinationId?{kind:c.destinationType,id:c.destinationId}:null;
        const current=target?(target.kind==='document'?useAppStore.getState().documents:useAppStore.getState().whiteboards).find(d=>d.id===target.id):null;
        return <ControlButton key={c.id} controlId="connection.destination" label={`Abrir destino de ${c.sourceText}`} className="connection-row" disabled={!target} onClick={()=>{if(target)onNavigate(target);}}><span className="text-rose-300">→</span><span className="truncate">{c.sourceText}</span><span className="ml-auto text-xs text-neutral-500 truncate">{current?.title||c.destinationTitle}{current?.deletedAt?' · Papelera':''}{!target?' · Enlace antiguo':''}</span></ControlButton>;
      })}
    </footer>}
  </section>;
}
