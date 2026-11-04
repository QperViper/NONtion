import { Command } from 'cmdk';
import { useEffect, useState } from 'react';
import { FileText, PenTool, Search, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore, resourcePath } from '../../store/useAppStore';
import type { ResourceRef } from '../../store/useAppStore';
import ControlButton from '../ControlButton';

export default function SearchModal() {
  const open = useAppStore(s=>s.isSearchOpen), pending = useAppStore(s=>s.pendingConnection);
  const documents = useAppStore(s=>s.documents), boards=useAppStore(s=>s.whiteboards);
  const navigate=useNavigate(); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  useEffect(()=>{
    const down=(e:KeyboardEvent)=>{if(e.key.toLowerCase()==='k'&&(e.ctrlKey||e.metaKey)){e.preventDefault();useAppStore.getState().setSearchOpen(!useAppStore.getState().isSearchOpen);}};
    window.addEventListener('keydown',down);return()=>window.removeEventListener('keydown',down);
  },[]);
  const choose=async(target:ResourceRef)=>{
    if(busy)return;setBusy(true);setError('');
    try{if(pending)await useAppStore.getState().connectTo(target);else{navigate(resourcePath(target));useAppStore.getState().setSearchOpen(false);}}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  return <Command.Dialog open={open} onOpenChange={value=>{if(!busy){useAppStore.getState().setSearchOpen(value);setError('');}}} label={pending?'Elegir destino del hiperhilo':'Buscar recursos'} className="search-dialog">
    {pending&&<div className="p-4 text-sm border-b border-white/10 text-rose-300">Conectar «{pending.text}»</div>}
    <div className="flex items-center p-4 gap-3"><Search size={19} className="text-neutral-400"/><Command.Input autoFocus placeholder="Buscar páginas o pizarras…" className="flex-1 min-w-0 bg-transparent outline-none"/><ControlButton controlId="search.close" label="Cerrar buscador" className="icon-button" icon={<X size={18}/>} disabled={busy} onClick={()=>useAppStore.getState().setSearchOpen(false)}/></div>
    <Command.List className="max-h-[55vh] overflow-y-auto p-2" aria-busy={busy}>
      <Command.Empty className="p-8 text-sm text-neutral-500 text-center">No hay recursos con ese nombre.</Command.Empty>
      <Command.Group heading="Páginas">{documents.filter(d=>!d.deletedAt).map(d=><Command.Item key={d.id} value={`${d.title} ${d.id}`} disabled={busy} onSelect={()=>{void choose({kind:'document',id:d.id});}}><FileText size={17}/><span>{d.title||'Sin título'}</span></Command.Item>)}</Command.Group>
      <Command.Group heading="Pizarras">{boards.filter(d=>!d.deletedAt).map(d=><Command.Item key={d.id} value={`${d.title} ${d.id}`} disabled={busy} onSelect={()=>{void choose({kind:'whiteboard',id:d.id});}}><PenTool size={17}/><span>{d.title}</span></Command.Item>)}</Command.Group>
    </Command.List>
    {(busy||error)&&<p role="status" className="p-4 text-sm text-rose-300">{error||'Guardando conexión…'}</p>}
  </Command.Dialog>;
}
