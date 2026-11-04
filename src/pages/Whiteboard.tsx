import { Tldraw, getSnapshot, loadSnapshot } from '@tldraw/tldraw';
import type { TLAssetStore, TLEditorSnapshot } from '@tldraw/tldraw';
import '@tldraw/tldraw/tldraw.css';
import { useAppStore } from '../store/useAppStore';

const assets: TLAssetStore = {
  upload:async (_asset,file)=>({src:await useAppStore.getState().uploadImage(file)}),
  resolve:asset=>asset.props.src,
};
export default function Whiteboard({boardId}:{boardId:string}) {
  const board=useAppStore.getState().whiteboards.find(b=>b.id===boardId)!;
  return <div className="whiteboard-editor"><Tldraw assets={assets} options={{maxPages:100}} onMount={editor=>{
    editor.user.updateUserPreferences({colorScheme:'dark'});
    if(board.snapshot && Object.keys(board.snapshot).length) {
      // Let the surrounding error boundary protect malformed/unsupported snapshots.
      loadSnapshot(editor.store,board.snapshot as unknown as TLEditorSnapshot);
    }
    return editor.store.listen(()=>{
      const snapshot=getSnapshot(editor.store);
      useAppStore.getState().updateWhiteboard(boardId,{snapshot:{document:snapshot.document}});
    },{scope:'document',source:'user'});
  }}/></div>;
}
