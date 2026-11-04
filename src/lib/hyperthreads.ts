import type { Block } from '@blocknote/core';

// The connection registry survives undo. Backlinks are shown only while the
// corresponding link is actually present in the source document.
export function threadIds(blocks: Block[]): Set<string> {
  const ids=new Set<string>();
  const visit=(value:unknown)=>{
    if(Array.isArray(value)){for(const item of value)visit(item);return;}
    if(!value||typeof value!=='object')return;
    const record=value as Record<string,unknown>;
    if(record.type==='link'&&typeof record.href==='string'&&record.href.startsWith('/hilo/'))ids.add(record.href.slice(6));
    for(const [key,item] of Object.entries(record))if(key!=='props')visit(item);
  };
  visit(blocks);return ids;
}
