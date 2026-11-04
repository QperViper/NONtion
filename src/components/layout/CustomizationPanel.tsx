import { useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { actionLabels, controlLabels } from '../../lib/controls';
import Dialog from '../Dialog';

export default function CustomizationPanel() {
  const id = useAppStore(s => s.editingControl);
  if (!id) return null;
  return <Editor key={id} id={id}/>;
}
function Editor({id}:{id:string}) {
  const config = useAppStore(s => s.customizations[id]) || {};
  const update = useAppStore(s => s.updateControl);
  const close = () => useAppStore.getState().setEditingControl(null);
  const [busy,setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  return <Dialog onClose={close} label="Personalizar control" className="w-full max-w-md p-6 space-y-5">
      <div className="flex justify-between gap-4"><div><h2 className="text-lg font-semibold">Personalizar control</h2><p className="text-sm text-neutral-400">{controlLabels[id] || 'Control personalizado'}</p></div><button onClick={close} aria-label="Cerrar personalización">✕</button></div>
      <p className="text-xs text-neutral-500">Se aplica a este botón en todas las páginas donde aparece.</p>
      <label className="field">Emoji<input autoFocus value={config.emoji || ''} maxLength={24} placeholder="✨" onChange={e => update(id,{emoji:e.target.value,image:null})}/></label>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={async e => {
        const file=e.target.files?.[0]; if(!file)return;setBusy(true);
        try{const image=await useAppStore.getState().uploadImage(file);update(id,{image});}catch{/* The store displays the upload error. */}finally{setBusy(false);}
      }}/>
      <button disabled={busy} className="soft-button w-full" onClick={() => fileRef.current?.click()}>{busy?'Subiendo…':'Elegir imagen o GIF'}</button>
      <div className="grid grid-cols-2 gap-4">
        <label className="field">Color<input type="color" value={config.color || '#eeeeee'} onChange={e => update(id,{color:e.target.value})}/></label>
        <label className="field">Fondo<input type="color" value={config.background || '#242428'} onChange={e => update(id,{background:e.target.value})}/></label>
      </div>
      <label className="field">Tamaño del icono · {config.size || 20}px<input type="range" min="12" max="48" value={config.size || 20} onChange={e => update(id,{size:Number(e.target.value)})}/></label>
      <label className="field">Redondeado · {config.radius ?? 8}px<input type="range" min="0" max="24" value={config.radius ?? 8} onChange={e => update(id,{radius:Number(e.target.value)})}/></label>
      {actionLabels[id] && <div className="grid grid-cols-2 gap-4">
        <label className="field">Zona<select value={config.zone || 'sidebar'} onChange={e => update(id,{zone:e.target.value as 'sidebar'|'toolbar'})}><option value="sidebar">Barra lateral</option><option value="toolbar">Barra superior</option></select></label>
        <label className="field">Orden<input type="number" min="0" max="100" value={config.order ?? Object.keys(actionLabels).indexOf(id)} onChange={e => update(id,{order:Math.max(0,Math.min(100,Number(e.target.value)))})}/></label>
      </div>}
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={config.hidden || false} onChange={e => update(id,{hidden:e.target.checked})}/>Ocultar durante el uso normal</label>
      <div className="flex justify-between gap-3"><button className="soft-button" onClick={() => update(id,null)}>Restaurar este control</button><button className="soft-button" onClick={close}>Listo</button></div>
  </Dialog>;
}
