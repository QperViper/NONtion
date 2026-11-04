import { useEffect, useEffectEvent, useRef } from 'react';
import type { ReactNode } from 'react';

export default function Dialog({children,onClose,label,labelledBy,describedBy,role='dialog',className=''}:{children:ReactNode;onClose:()=>void;label?:string;labelledBy?:string;describedBy?:string;role?:'dialog'|'alertdialog';className?:string}) {
  const surface=useRef<HTMLElement>(null);
  const close=useEffectEvent(onClose);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    const dialog=surface.current!;
    const focusable=()=>[...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not([type=hidden]):not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(el=>el.getClientRects().length>0);
    if(!dialog.contains(document.activeElement)) (dialog.querySelector<HTMLElement>('[autofocus]')||focusable()[0]||dialog).focus();
    const keydown=(event:KeyboardEvent)=>{
      const dialogs=[...document.querySelectorAll('[aria-modal="true"]')].filter(el=>el.getClientRects().length>0);
      if(dialogs.at(-1)!==dialog)return;
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
      if(event.key==='Tab'){
        const items=focusable(),first=items[0],last=items.at(-1);
        if(!first){event.preventDefault();dialog.focus();}
        else if(event.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){event.preventDefault();first.focus();}
      }
    };
    document.addEventListener('keydown',keydown);
    return()=>{document.removeEventListener('keydown',keydown);if(previous?.isConnected)previous.focus();};
  },[]);
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section ref={surface} tabIndex={-1} role={role} aria-modal="true" aria-label={label} aria-labelledby={labelledBy} aria-describedby={describedBy} className={`glass-modal ${className}`}>{children}</section></div>;
}
