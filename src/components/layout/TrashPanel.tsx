import { RotateCcw, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import ControlButton from '../ControlButton';
import Dialog from '../Dialog';

export default function TrashPanel({onClose}:{onClose:()=>void}) {
  const docs=useAppStore(s=>s.documents),boards=useAppStore(s=>s.whiteboards);
  const items=[...docs.filter(d=>d.deletedAt).map(d=>({...d,kind:'document' as const})),...boards.filter(d=>d.deletedAt).map(d=>({...d,kind:'whiteboard' as const}))];
  return <Dialog onClose={onClose} label="Papelera" className="p-6 w-full max-w-lg">
    <div className="flex justify-between mb-3"><h2 className="text-xl font-semibold">Papelera</h2><ControlButton controlId="trash.close" label="Cerrar papelera" className="icon-button" icon={<X size={18}/>} onClick={onClose}/></div><p className="text-sm text-neutral-400 mb-6">Tus recursos y sus conexiones se conservan hasta que los restaures.</p>
    {!items.length&&<p className="text-neutral-500 py-8 text-center">La papelera está vacía.</p>}
    <div className="space-y-2 max-h-[60vh] overflow-y-auto">{items.map(item=><div key={item.id} className="flex items-center gap-3 rounded-lg bg-white/5 p-3"><div className="flex-1 min-w-0"><p className="truncate">{item.title||'Sin título'}</p><span className="text-xs text-neutral-500">{item.kind==='document'?'Página':'Pizarra'}</span></div><ControlButton controlId="trash.restore" label={`Restaurar ${item.title}`} className="soft-button" icon={<RotateCcw size={16}/>} onClick={()=>item.kind==='document'?useAppStore.getState().updateDocument(item.id,{deletedAt:null}):useAppStore.getState().updateWhiteboard(item.id,{deletedAt:null})}>Restaurar</ControlButton></div>)}</div>
  </Dialog>;
}
