import { FilePlus2, PenTool, Search, Settings2, Trash2, Palette } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import ControlButton from '../ControlButton';

import { actionLabels } from '../../lib/controls';
export default function ActionControls({zone,onSettings,onTrash}: {zone:'sidebar'|'toolbar';onSettings:()=>void;onTrash:()=>void}) {
  const styles = useAppStore(s => s.customizations);
  const navigate = useNavigate();
  const [busy,setBusy] = useState(false);
  const actions = [
    {id:'action.search',icon:<Search size={17}/>,run:() => useAppStore.getState().setSearchOpen(true)},
    {id:'action.document',icon:<FilePlus2 size={17}/>,run:async () => { const id = await useAppStore.getState().createDocument(); if(id) navigate(`/${id}`); }},
    {id:'action.whiteboard',icon:<PenTool size={17}/>,run:async () => { const id = await useAppStore.getState().createWhiteboard(); if(id) navigate(`/pizarra/${id}`); }},
    {id:'action.settings',icon:<Settings2 size={17}/>,run:onSettings},
    {id:'action.trash',icon:<Trash2 size={17}/>,run:onTrash},
    {id:'action.customize',icon:<Palette size={17}/>,run:() => useAppStore.getState().setCustomizing(true)},
  ].filter(a => (styles[a.id]?.zone || 'sidebar') === zone).sort((a,b) => (styles[a.id]?.order ?? Object.keys(actionLabels).indexOf(a.id)) - (styles[b.id]?.order ?? Object.keys(actionLabels).indexOf(b.id)));
  return <div className={zone === 'sidebar' ? 'flex flex-col gap-1' : 'flex items-center gap-1 flex-wrap'}>
    {actions.map(action => <ControlButton key={action.id} controlId={action.id} label={actionLabels[action.id]} icon={action.icon} disabled={busy}
      className="nav-action" onClick={async () => {setBusy(true);try{await action.run();}finally{setBusy(false);}}}>
      <span>{actionLabels[action.id]}</span>
    </ControlButton>)}
  </div>;
}
