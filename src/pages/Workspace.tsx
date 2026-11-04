import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/mantine/style.css';
import { Link2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import ControlButton from '../components/ControlButton';

export default function Workspace({documentId}:{documentId:string}) {
  const doc = useAppStore.getState().documents.find(d=>d.id===documentId)!;
  const editor = useCreateBlockNote({initialContent:doc.content.length?doc.content:undefined,
    uploadFile:file=>useAppStore.getState().uploadImage(file),
  });
  const [selection,setSelection]=useState(false);
  const [menu,setMenu]=useState<{x:number;y:number}|null>(null);
  const container=useRef<HTMLDivElement>(null);
  const connect=()=>{
    const text=editor.getSelectedText();if(!text.trim())return;
    const blockId=editor.getTextCursorPosition().block.id;
    const {from,to}=editor.transact(tr=>({from:tr.selection.from,to:tr.selection.to}));
    const original=editor.document;
    useAppStore.getState().startConnection({sourceDocId:documentId,sourceBlockId:blockId,text,apply:url=>{
      // The modal holds focus; keep the captured range rather than the DOM selection.
      if(editor.document!==original && JSON.stringify(editor.document)!==JSON.stringify(original))throw new Error('El texto cambió. Selecciona de nuevo el fragmento.');
      editor.transact(tr=>{tr.addMark(from,to,editor.pmSchema.mark('link',{href:url}));});
    }});
    setMenu(null);
  };
  return <div ref={container} className="note-editor relative" onContextMenu={event=>{
    if(!editor.getSelectedText().trim())return;
    event.preventDefault();setMenu({x:Math.max(8,Math.min(event.clientX,window.innerWidth-260)),y:Math.max(8,Math.min(event.clientY,window.innerHeight-100))});
  }}>
    <div className="editor-actions"><ControlButton controlId="editor.connect" label="Conectar texto seleccionado" className="soft-button text-xs" icon={<Link2 size={14}/>} disabled={!selection} onMouseDown={e=>e.preventDefault()} onClick={connect}>Conectar selección</ControlButton></div>
    <BlockNoteView editor={editor} theme="dark" onChange={()=>useAppStore.getState().updateDocument(documentId,{content:editor.document})} onSelectionChange={()=>setSelection(Boolean(editor.getSelectedText().trim()))}/>
    {menu&&<><div className="fixed inset-0 z-[70]" onClick={()=>setMenu(null)} onContextMenu={e=>{e.preventDefault();setMenu(null);}}/><div role="menu" className="fixed z-[71] glass-modal p-1" style={{left:menu.x,top:menu.y}}><ControlButton controlId="editor.context-connect" label="Crear hiperhilo" className="nav-action" icon={<Link2 size={16}/>} onMouseDown={e=>e.preventDefault()} onClick={connect}>Crear hiperhilo</ControlButton></div></>}
  </div>;
}
