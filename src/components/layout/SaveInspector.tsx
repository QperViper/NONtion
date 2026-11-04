import { useAppStore } from '../../store/useAppStore';
import { exportJson } from '../../lib/exportJson';
import { useState } from 'react';
import type { Draft } from '../../lib/drafts';
import Dialog from '../Dialog';

export default function SaveInspector() {
  const [resolution,setResolution]=useState<{key:string;keepLocal:boolean;draft?:Draft}|null>(null);
  const states=useAppStore(s=>s.saveStates),drafts=useAppStore(s=>s.orphanDrafts);
  const problems=Object.entries(states).filter(([,s])=>s.status==='error'||s.status==='conflict');
  if(!problems.length&&!drafts.length)return null;
  return <><details className="save-inspector" open>
    <summary>{problems.length?'Hay cambios que necesitan atención':'Hay borradores de otras sesiones'}</summary>
    <div className="space-y-3 mt-3">
      {problems.map(([key,state])=>{
        const s=useAppStore.getState();
        const local=key==='settings:1'?{backgroundEffect:s.backgroundEffect,themeColor:s.themeColor,bgImage:s.bgImage,bgBlur:s.bgBlur,bgBloom:s.bgBloom,customizations:s.customizations}:[...s.documents,...s.whiteboards].find(d=>key.endsWith(`:${d.id}`));
        return <div key={key} className="text-sm"><p className="font-medium">{local&&'title' in local?local.title:'Apariencia'}</p><p className="text-amber-200/80 my-2">{state.message||'Borrador pendiente de sincronizar.'}</p>
          <div className="flex gap-2 flex-wrap"><button className="soft-button" onClick={()=>exportJson({key,local,server:state.remote},'borrador-nontion.json')}>Exportar borrador</button>
            {state.status==='conflict'?<><button className="soft-button" onClick={()=>setResolution({key,keepLocal:true})}>Conservar mi versión</button><button className="soft-button" onClick={()=>setResolution({key,keepLocal:false})}>Usar servidor</button></>:<button className="soft-button" onClick={s.retrySaves}>Reintentar</button>}
          </div></div>;
      })}
      {drafts.map(d=><div key={d.key} className="flex gap-3 items-center flex-wrap text-sm"><span className="truncate flex-1">{String(d.patch.title||(d.key.endsWith('settings:1')?'Apariencia de otra sesión':'Borrador de otra sesión'))}</span><button className="soft-button" onClick={()=>exportJson(d,'borrador-recuperado.json')}>Exportar</button><button className="soft-button" onClick={()=>{void useAppStore.getState().recoverDraft(d).catch(e=>useAppStore.getState().setError(e.message));}}>Recuperar</button><button className="quiet-button" onClick={()=>setResolution({key:d.key,keepLocal:false,draft:d})}>Descartar</button></div>)}
    </div>
  </details>{resolution&&<Dialog onClose={()=>setResolution(null)} role="alertdialog" labelledBy="resolve-title" describedBy="resolve-description" className="p-6 w-full max-w-md"><h2 id="resolve-title" className="text-lg font-semibold">{resolution.draft?'Descartar borrador de otra sesión':resolution.keepLocal?'Conservar tu versión':'Usar la versión del servidor'}</h2><p id="resolve-description" className="text-sm text-neutral-400 my-4">{resolution.draft?'Se eliminará esta copia local. Si la otra sesión sigue abierta, comprueba primero que sus cambios estén guardados. Puedes exportar el borrador antes de decidir.':resolution.keepLocal?'Tus cambios pendientes se guardarán sobre la versión del servidor. Puedes exportar ambas versiones antes de decidir.':'Tu borrador de este recurso se descartará en este navegador. Puedes exportarlo antes de decidir.'}</p><div className="flex flex-wrap gap-3"><button autoFocus className="soft-button" onClick={()=>setResolution(null)}>Cancelar</button><button className="soft-button" onClick={()=>{const choice=resolution;setResolution(null);if(choice.draft)void useAppStore.getState().discardDraft(choice.draft);else void useAppStore.getState().resolveConflict(choice.key,choice.keepLocal);}}>Confirmar decisión</button></div></Dialog>}</>;
}
