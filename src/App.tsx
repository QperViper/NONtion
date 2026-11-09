import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Suspense, lazy, useEffect, useState } from 'react';
import { PanelLeftOpen } from 'lucide-react';
import Sidebar from './components/layout/Sidebar';
import SettingsPanel from './components/layout/SettingsPanel';
import SearchModal from './components/layout/SearchModal';
import ActionControls from './components/layout/ActionControls';
import CustomizationPanel from './components/layout/CustomizationPanel';
import SaveInspector from './components/layout/SaveInspector';
import TrashPanel from './components/layout/TrashPanel';
import ResourcePanel from './components/ResourcePanel';
import ControlButton from './components/ControlButton';
import { resourceKey, resourcePath, useAppStore } from './store/useAppStore';
import type { ResourceRef } from './store/useAppStore';
import ImageAsset from './components/ImageAsset';
import VignetteBloomBackground from './components/VignetteBloomBackground';
// El calendario (FullCalendar) se descarga solo al abrirlo.
const CalendarPage=lazy(()=>import('./pages/Calendar'));
const InternetPage=lazy(()=>import('./pages/Internet'));

function Home({boardsOnly=false}:{boardsOnly?:boolean}) {
  const documents=useAppStore(s=>s.documents),boards=useAppStore(s=>s.whiteboards);
  const navigate=useNavigate();const [busy,setBusy]=useState(false);
  const first=boardsOnly?boards.find(d=>!d.deletedAt):documents.find(d=>!d.deletedAt);
  if(first)return <Navigate replace to={boardsOnly?`/pizarra/${first.id}`:`/${first.id}`}/>;
  return <div className="empty-state"><span className="text-xs tracking-[.25em] text-rose-300 uppercase">Espacio de Nicolás</span><h1>{boardsOnly?'Dale espacio a una idea.':'Empieza con una idea.'}</h1><p>{boardsOnly?'Crea una pizarra y conecta tus bocetos con tus notas.':'Crea una página. Escribe, dibuja y conecta lo que descubras.'}</p><ControlButton controlId="home.create" label={boardsOnly?'Crear pizarra':'Crear página'} className="soft-button" disabled={busy} onClick={async()=>{setBusy(true);const id=await(boardsOnly?useAppStore.getState().createWhiteboard():useAppStore.getState().createDocument());setBusy(false);if(id)navigate(boardsOnly?`/pizarra/${id}`:`/${id}`);}}>{busy?'Creando…':boardsOnly?'Crear pizarra':'Crear primera página'}</ControlButton></div>;
}
function ThreadRoute() {
  const {threadId}=useParams();const thread=useAppStore(s=>s.connections.find(c=>c.id===threadId));
  if(thread?.destinationType&&thread.destinationId)return <Navigate replace to={resourcePath({kind:thread.destinationType,id:thread.destinationId})}/>;
  return <div className="p-10">No se encontró esta conexión.</div>;
}
function Panels({kind}:{kind:'document'|'whiteboard'}) {
  const {documentId,boardId}=useParams(); const id=(kind==='document'?documentId:boardId)!;
  const panels=useAppStore(s=>s.panels),replace=useAppStore(s=>s.replaceTarget);
  const navigate=useNavigate(); const primary={kind,id};
  const visible=[primary,...panels.filter(p=>resourceKey(p)!==resourceKey(primary))].slice(0,3);
  useEffect(()=>{useAppStore.getState().setCurrentDoc(kind==='document'?id:null);useAppStore.getState().closePanel(id);document.querySelector('.workspace-content')?.scrollTo({left:0,top:0});},[kind,id]);
  const open=(target:ResourceRef)=>{
    if(resourceKey(target)===resourceKey(primary)){document.querySelector('[data-primary-panel]')?.scrollIntoView({behavior:'smooth',inline:'start'});return;}
    useAppStore.getState().openBeside(target);
    setTimeout(()=>document.querySelector(`[data-resource="${resourceKey(target)}"]`)?.scrollIntoView({behavior:'smooth',inline:'nearest',block:'nearest'}),50);
  };
  return <><div className="panels" onClickCapture={event=>{
    const anchor=(event.target as HTMLElement).closest('a[href]');if(!anchor)return;
    const url=new URL((anchor as HTMLAnchorElement).href,window.location.href);
    if(url.origin!==window.location.origin)return;
    const threadId=url.pathname.startsWith('/hilo/')?url.pathname.slice(6):null;
    if(threadId){event.preventDefault();event.stopPropagation();const thread=useAppStore.getState().connections.find(c=>c.id===threadId);if(thread?.destinationId&&thread.destinationType)open({kind:thread.destinationType,id:thread.destinationId});else useAppStore.getState().setError('Esta conexión no está disponible.');}
  }}>
    {visible.map((ref,index)=><div key={resourceKey(ref)} data-primary-panel={index===0?'true':undefined} className="panel-slot"><ResourcePanel resource={ref} onClose={index?()=>useAppStore.getState().closePanel(ref.id):undefined} onNavigate={open}/>{index>0&&<button className="open-full" onClick={()=>navigate(resourcePath(ref))}>Abrir como principal ↗</button>}</div>)}
  </div>{replace&&<div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-label="Elegir panel que reemplazar" className="glass-modal p-6 max-w-md w-full"><h2 className="text-lg font-semibold">Los tres paneles están ocupados</h2><p className="text-neutral-400 text-sm my-3">Elige qué panel lateral reemplazar. Sus cambios pendientes se conservan.</p><div className="flex flex-col gap-2">{panels.map(p=><button key={p.id} className="soft-button" onClick={()=>useAppStore.getState().replacePanel(p.id)}>{(p.kind==='document'?useAppStore.getState().documents:useAppStore.getState().whiteboards).find(d=>d.id===p.id)?.title||'Sin título'}</button>)}<button className="quiet-button" onClick={()=>useAppStore.getState().cancelReplace()}>Cancelar</button></div></section></div>}</>;
}
function Shell() {
  const loaded=useAppStore(s=>s.isLoaded),loading=useAppStore(s=>s.loading),loadError=useAppStore(s=>s.loadError);
  const theme=useAppStore(s=>s.themeColor),image=useAppStore(s=>s.bgImage),blur=useAppStore(s=>s.bgBlur),brightness=useAppStore(s=>s.bgBloom);
  const backgroundEffect=useAppStore(s=>s.backgroundEffect),pauseAnimations=useAppStore(s=>s.pauseAnimations);
  const sidebar=useAppStore(s=>s.isSidebarOpen),error=useAppStore(s=>s.error),customizing=useAppStore(s=>s.isCustomizing);
  const fetchInitialData=useAppStore(s=>s.fetchInitialData);
  const location=useLocation(),boardFocus=useAppStore(s=>s.boardFocus);
  const focus=boardFocus&&/^\/pizarra\/[^/]+/.test(location.pathname);
  const [settings,setSettings]=useState(false),[trash,setTrash]=useState(false);
  useEffect(()=>{void fetchInitialData();},[fetchInitialData]);
  useEffect(()=>{const down=(e:KeyboardEvent)=>{if(e.key==='Escape'){useAppStore.getState().setEditingControl(null);if(useAppStore.getState().boardFocus&&!document.querySelector('.tl-container:focus-within'))useAppStore.getState().setBoardFocus(false);if(!useAppStore.getState().isSearchOpen){setSettings(false);setTrash(false);}}};window.addEventListener('keydown',down);return()=>window.removeEventListener('keydown',down);},[]);
  if(!loaded)return <div className="startup"><div className="glass-modal p-8 max-w-md"><h1 className="text-2xl font-semibold mb-3">Espacio de Nicolás</h1><p className="text-neutral-400" role="status">{loadError||'Conectando con tu espacio…'}</p>{loadError&&<button className="soft-button mt-5" disabled={loading} onClick={()=>{void useAppStore.getState().fetchInitialData();}}>Reintentar conexión</button>}</div></div>;
  return <div className={`app-shell${focus?' board-focus':''}`} style={{backgroundColor:theme}}>
    {backgroundEffect === 'vignette-bloom'
      ? <VignetteBloomBackground className="ascii-workspace-background" paused={pauseAnimations} onError={message=>useAppStore.getState().setError(message)}/>
      : image&&<ImageAsset src={image} className="workspace-background" style={{filter:`blur(${blur}px) brightness(${brightness}%)`}}/>}
    <div className="workspace-layout"><Sidebar onOpenSettings={()=>setSettings(true)} onOpenTrash={()=>setTrash(true)}/><div className="workspace-main">
      <div className="workspace-toolbar">
        {!sidebar&&<button className="icon-button" aria-label="Abrir barra lateral" onClick={()=>useAppStore.getState().toggleSidebar()}><PanelLeftOpen size={19}/></button>}
        <ActionControls zone="toolbar" onSettings={()=>setSettings(true)} onTrash={()=>setTrash(true)}/>
        <div className="ml-auto flex gap-2 items-center"><span className="text-xs text-neutral-500 hidden sm:inline">Personal, conectado.</span><button className="quiet-button text-xs" onClick={()=>useAppStore.getState().setCustomizing(!customizing)}>{customizing?'Terminar personalización':'Personalizar'}</button></div>
      </div>
      {customizing&&<div className="customize-banner"><span>Modo Personalizar: pulsa un control para editarlo. Los ocultos vuelven a mostrarse.</span><button className="underline shrink-0" onClick={()=>useAppStore.getState().setCustomizing(false)}>Terminar</button></div>}
      <main className="workspace-content"><Routes><Route path="/" element={<Home/>}/><Route path="/pizarra" element={<Home boardsOnly/>}/><Route path="/pizarra/:boardId" element={<Panels kind="whiteboard"/>}/><Route path="/hilo/:threadId" element={<ThreadRoute/>}/><Route path="/internet" element={<Suspense fallback={<div className="p-8 text-neutral-400">Abriendo…</div>}><InternetPage/></Suspense>}/><Route path="/calendario" element={<Suspense fallback={<div className="p-8 text-neutral-400">Abriendo calendario…</div>}><CalendarPage/></Suspense>}/><Route path="/:documentId" element={<Panels kind="document"/>}/><Route path="*" element={<div className="p-10">Esta dirección no existe.</div>}/></Routes></main>
    </div></div>
    {settings&&<SettingsPanel onClose={()=>setSettings(false)}/>}{trash&&<TrashPanel onClose={()=>setTrash(false)}/>}
    <SearchModal/><SaveInspector/>
    {error&&<div role="alert" className="error-toast"><span>{error}</span><button aria-label="Cerrar aviso" onClick={()=>useAppStore.getState().setError(null)}>✕</button></div>}
    <CustomizationPanel/>
  </div>;
}
export default function App(){return <BrowserRouter><Shell/></BrowserRouter>;}
