import { Palette, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { controlLabels } from '../../lib/controls';
import ControlButton from '../ControlButton';
import VignetteBloomBackground from '../VignetteBloomBackground';

export default function SettingsPanel({onClose}:{onClose:()=>void}) {
  const s=useAppStore();const [url,setUrl]=useState(''),[busy,setBusy]=useState(false);const input=useRef<HTMLInputElement>(null);
  return <section className="settings-panel glass-surface" style={{width:s.settingsWidth}} aria-label="Apariencia">
    <div className="settings-resize" role="separator" aria-orientation="vertical" aria-label="Ancho de ajustes" tabIndex={0}
      onKeyDown={e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();s.setSettingsWidth(s.settingsWidth+(e.key==='ArrowLeft'?20:-20));}}}
      onPointerDown={e=>e.currentTarget.setPointerCapture(e.pointerId)} onPointerMove={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))s.setSettingsWidth(window.innerWidth-e.clientX);}} onPointerUp={e=>e.currentTarget.releasePointerCapture(e.pointerId)}/>
    <header className="flex justify-between items-center"><h2 className="font-semibold flex items-center gap-2"><Palette size={18}/>Apariencia</h2><ControlButton controlId="settings.close" label="Cerrar ajustes" className="icon-button" icon={<X size={18}/>} onClick={onClose}/></header>
    <p className="text-sm text-neutral-400">Haz que este espacio se sienta tuyo.</p>
    <div><h3 className="nav-heading mb-3">COLOR DEL ESPACIO</h3><div className="flex flex-wrap gap-3 mb-4">{['#191919','#1e293b','#312e81','#4a044e','#7f1d1d','#064e3b','#b45309','#0f766e'].map(color=><button key={color} aria-label={`Usar color ${color}`} aria-pressed={s.themeColor===color} className={`color-swatch ${s.themeColor===color?'selected':''}`} style={{backgroundColor:color}} onClick={()=>s.setThemeColor(color)}/>)}</div><label className="field">Color personalizado<input type="color" value={s.themeColor} onChange={e=>s.setThemeColor(e.target.value)}/></label></div>
    <div className="settings-section"><h3 className="nav-heading mb-3">FONDO DE PANTALLA</h3>
      <div className="background-choices" role="group" aria-label="Elegir fondo del espacio">
        <button type="button" aria-pressed={!s.backgroundEffect} className={`background-choice ${!s.backgroundEffect?'selected':''}`} onClick={()=>s.setBackgroundEffect(null)}>
          <span className="background-color-preview" style={{backgroundColor:s.themeColor}}/><span>Color o imagen</span>
        </button>
        <button type="button" aria-pressed={s.backgroundEffect==='vignette-bloom'} className={`background-choice ${s.backgroundEffect==='vignette-bloom'?'selected':''}`} onClick={()=>s.setBackgroundEffect('vignette-bloom')}>
          <span className="background-effect-preview"><VignetteBloomBackground paused className="background-effect-thumbnail"/></span><span>Vignette Bloom</span>
        </button>
      </div>
      {s.backgroundEffect==='vignette-bloom'&&<div className="background-effect-description"><p>Mosaico animado con viñeta y resplandor.</p><p>Se usa la foto y el preset proporcionado de 21st.dev.</p></div>}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;setBusy(true);try{s.setBgImage(await s.uploadImage(file));}catch{/* displayed globally */}finally{setBusy(false);e.target.value='';}}}/>
      <ControlButton controlId="settings.upload-background" label="Subir fondo" className="soft-button w-full" disabled={busy} icon={<Upload size={16}/>} onClick={()=>input.current?.click()}>{busy?'Subiendo…':'Elegir imagen o GIF'}</ControlButton>
      <form className="flex gap-2 mt-3" onSubmit={e=>{e.preventDefault();try{const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol))throw new Error();s.setBgImage(parsed.href);setUrl('');}catch{s.setError('Usa una URL http o https válida.');}}}><input aria-label="URL de imagen de fondo" type="url" placeholder="https://…" value={url} onChange={e=>setUrl(e.target.value)} className="text-input min-w-0 flex-1"/><ControlButton controlId="settings.apply-background" label="Aplicar URL de fondo" className="soft-button" type="submit">Aplicar</ControlButton></form>
      {s.bgImage&&!s.backgroundEffect&&<div className="space-y-4 mt-5"><label className="field">Desenfoque · {s.bgBlur}px<input type="range" min="0" max="30" value={s.bgBlur} onChange={e=>s.setBgBlur(Number(e.target.value))}/></label><label className="field">Brillo · {s.bgBloom}%<input type="range" min="25" max="200" value={s.bgBloom} onChange={e=>s.setBgBloom(Number(e.target.value))}/></label><ControlButton controlId="settings.remove-background" label="Quitar fondo" className="quiet-button text-rose-300" onClick={()=>s.setBgImage(null)}>Quitar fondo</ControlButton></div>}
      <p className="text-xs text-neutral-500 mt-3">Los archivos subidos se conservan en tu equipo. Las URL externas necesitan conexión a su servidor.</p>
    </div>
    <div className="settings-section space-y-4"><h3 className="nav-heading">CONTROLES A TU MEDIDA</h3><ControlButton controlId="settings.customize" label="Activar personalización" className="soft-button w-full" onClick={()=>{s.setCustomizing(true);onClose();}}>Personalizar la interfaz</ControlButton><p className="text-xs text-neutral-400">Clic derecho sobre un control para cambiar emoji, imagen, GIF, colores y forma. Las acciones principales también se pueden mover entre zonas.</p>
      <label className="flex gap-3 text-sm items-start"><input type="checkbox" checked={s.pauseAnimations} onChange={e=>s.setPauseAnimations(e.target.checked)}/>Reducir animaciones</label>
      <div className="space-y-1">{Object.keys(s.customizations).map(id=><div key={id} className="flex gap-2 items-center text-xs"><button className="quiet-button truncate flex-1 text-left" onClick={()=>s.setEditingControl(id)}>{controlLabels[id]||'Control personalizado'}{s.customizations[id].hidden?' · oculto':''}</button><button aria-label={`Restaurar ${controlLabels[id]||'control'}`} className="quiet-button" onClick={()=>s.updateControl(id,null)}>Restaurar</button></div>)}</div>
    </div>
  </section>;
}
