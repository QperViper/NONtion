import { CalendarDays, Camera, FileText, Globe, PanelLeftClose, PenTool, Trash2, Star } from 'lucide-react';
import { shortWhen, upcoming } from '../../lib/calendar';
import { useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useAppStore, resourcePath } from '../../store/useAppStore';
import ImageAsset from '../ImageAsset';
import ActionControls from './ActionControls';
import ControlButton from '../ControlButton';
import SyncIndicator from '../SyncIndicator';

export default function Sidebar({onOpenSettings,onOpenTrash}:{onOpenSettings:()=>void;onOpenTrash:()=>void}) {
  const documents = useAppStore(s => s.documents);
  const boards = useAppStore(s => s.whiteboards);
  const events = useAppStore(s => s.events);
  // Reloj para «Próximos»: se actualiza cada minuto (hoy → mañana, eventos que terminan).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  const width = useAppStore(s => s.sidebarWidth);
  const open = useAppStore(s => s.isSidebarOpen);
  const avatar = useAppStore(s => s.avatarImage);
  const menu = useAppStore(s => s.menuIconImage);
  const avatarInput = useRef<HTMLInputElement>(null);
  const navigate = useNavigate(); const location = useLocation();
  if (!open) return null;
  const resources = [...documents.filter(d => !d.deletedAt).map(d => ({...d,kind:'document' as const})),...boards.filter(d => !d.deletedAt).map(d => ({...d,kind:'whiteboard' as const}))];
  return <aside className="sidebar glass-surface" style={{width}}>
    <div className="flex items-center gap-3 px-4 py-5">
      <input ref={avatarInput} className="hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={async e => {const file=e.target.files?.[0];if(file)try{useAppStore.getState().setAvatarImage(await useAppStore.getState().uploadImage(file));}catch{/* displayed globally */}}}/>
      <ControlButton controlId="sidebar.avatar" label="Cambiar avatar" className="avatar" onClick={() => avatarInput.current?.click()} icon={avatar?<ImageAsset src={avatar}/>:<span>N</span>}/>
      <div className="min-w-0 flex-1"><div className="font-semibold text-sm truncate">Espacio de Nicolás</div><div className="text-xs text-neutral-500">Tu red de ideas</div></div>
      <ControlButton controlId="sidebar.toggle" label="Cerrar barra lateral" className="icon-button" icon={menu?<ImageAsset src={menu} className="w-5 h-5"/>:<PanelLeftClose size={17}/>} onClick={() => useAppStore.getState().toggleSidebar()}/>
    </div>
    <div className="px-3 pb-4"><ActionControls zone="sidebar" onSettings={onOpenSettings} onTrash={onOpenTrash}/></div>
    <nav className="flex-1 overflow-y-auto px-3 pb-6" aria-label="Recursos">
      <section className="mb-6">
        <ControlButton controlId="sidebar.calendar" label="Abrir calendario" className={`nav-action w-full ${location.pathname==='/calendario'?'is-active':''}`} icon={<CalendarDays size={16}/>} onClick={()=>navigate('/calendario')}><span>Calendario</span></ControlButton>
        <ControlButton controlId="sidebar.internet" label="Abrir Internet" className={`nav-action w-full ${location.pathname==='/internet'?'is-active':''}`} icon={<Globe size={16}/>} onClick={()=>navigate('/internet')}><span>Internet</span></ControlButton>
        <ControlButton controlId="sidebar.camera" label="Abrir cámara del celular" className={`nav-action w-full ${location.pathname==='/camara'?'is-active':''}`} icon={<Camera size={16}/>} onClick={()=>navigate('/camara')}><span>Cámara</span></ControlButton>
        {/* Próximos 7 días, sin completar: un vistazo sin abrir el calendario. */}
        {(()=>{const soon=upcoming(events,now);
          return soon.length>0&&<ul className="upcoming" aria-label="Próximos eventos">{soon.map(e=><li key={e.id}><button className="upcoming-item" onClick={()=>navigate('/calendario')}><span className="upcoming-dot" style={{background:e.color}} aria-hidden/>{e.emoji&&<span aria-hidden>{e.emoji}</span>}<span className="truncate flex-1">{e.title}</span><span className="upcoming-when">{shortWhen(e.startAt,e.allDay,new Date(now))}</span></button></li>)}</ul>;})()}
      </section>
      {(['document','whiteboard'] as const).map(kind => <section key={kind} className="mb-6">
        <h2 className="nav-heading">{kind === 'document'?'PÁGINAS':'PIZARRAS'}</h2>
        {resources.filter(r=>r.kind===kind).map(r => <div key={r.id} className="resource-row group">
          <ControlButton controlId={`resource.${kind}`} label={`Abrir ${r.title || 'Sin título'}`} className={`nav-action flex-1 min-w-0 ${location.pathname===resourcePath(r)?'is-active':''}`}
            icon={r.kind==='document' && r.icon?<ImageAsset src={r.icon} className="w-5 h-5 rounded object-cover"/>:kind==='document'?<FileText size={16}/>:<PenTool size={16}/>} onClick={()=>navigate(resourcePath(r))}>
            <span className="truncate">{r.title || 'Sin título'}</span>{r.kind==='document'&&r.isFavorite&&<Star size={12} className="ml-auto text-amber-300"/>}
          </ControlButton>
          <ControlButton controlId="resource.trash" label={`Enviar ${r.title} a la papelera`} className="icon-button row-delete" icon={<Trash2 size={14}/>} onClick={()=>{
            if(r.kind==='document')useAppStore.getState().deleteDocument(r.id);else useAppStore.getState().updateWhiteboard(r.id,{deletedAt:new Date().toISOString()});
          }}/>
        </div>)}
        {!resources.some(r=>r.kind===kind)&&<p className="px-3 py-2 text-xs text-neutral-500">{kind==='document'?'Crea tu primera página.':'Un lienzo para tus ideas.'}</p>}
      </section>)}
      {documents.some(d=>d.isFavorite&&!d.deletedAt)&&<section><h2 className="nav-heading">FAVORITOS</h2>{documents.filter(d=>d.isFavorite&&!d.deletedAt).map(d=><ControlButton key={d.id} controlId="resource.favorite" label={`Abrir ${d.title}`} className="nav-action w-full" icon={<Star size={15}/>} onClick={()=>navigate(`/${d.id}`)}><span className="truncate">{d.title}</span></ControlButton>)}</section>}
    </nav>
    <div className="px-3 pb-3"><SyncIndicator/></div>
    <div className="resize-handle" role="separator" aria-label="Ancho de barra lateral" aria-orientation="vertical" tabIndex={0}
      onKeyDown={e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();useAppStore.getState().setSidebarWidth(width+(e.key==='ArrowRight'?20:-20));}}}
      onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);}}
      onPointerMove={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))useAppStore.getState().setSidebarWidth(e.clientX);}}
      onPointerUp={e=>e.currentTarget.releasePointerCapture(e.pointerId)}/>
  </aside>;
}
