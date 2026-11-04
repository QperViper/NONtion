import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SaveQueue } from '../../src/lib/saveQueue.ts';
import type { Draft, DraftStorage } from '../../src/lib/drafts.ts';
import type { SaveState } from '../../src/lib/saveQueue.ts';

function storage(): DraftStorage & {data:Map<string,Draft>} {
  const data=new Map<string,Draft>();
  return {data,async put(d){data.set(d.key,structuredClone(d));},async remove(k){data.delete(k);},async all(){return [...data.values()];}};
}
test('serializa ediciones durante una petición y conserva los cambios nuevos',async()=>{
  const disk=storage();let release!:(value:Record<string,unknown>)=>void;const sent:Draft[]=[];
  const queue=new SaveQueue(disk,async d=>{sent.push(structuredClone(d));if(sent.length===1)return new Promise(resolve=>{release=resolve;});return {version:3,title:'nuevo',content:['b']};},()=>{});
  try {
    await queue.enqueue('document:1',1,{title:'primero',content:['a']});
    const saving=queue.flush('document:1');
    await queue.enqueue('document:1',1,{title:'nuevo',content:['b']});
    await queue.flush('document:1');assert.equal(sent.length,1);
    release({version:2,title:'primero',content:['a']});await saving;
    assert.deepEqual(queue.pending()[0],{key:'document:1',version:2,patch:{title:'nuevo',content:['b']}});
    await queue.flush('document:1');assert.equal(sent[1].version,2);assert.equal(queue.pending().length,0);assert.equal(disk.data.size,0);
  } finally {queue.stop();}
});
test('conserva el borrador ante fallo de red y lo recupera tras reiniciar',async()=>{
  const disk=storage();const states:SaveState[]=[];
  const first=new SaveQueue(disk,async()=>{throw new Error('Sin conexión');},(_,s)=>states.push(s));
  await first.enqueue('whiteboard:1',4,{snapshot:{document:{shapes:['uno']}}});await first.flush('whiteboard:1');first.stop();
  assert.equal(states.at(-1)?.status,'error');assert.equal(disk.data.size,1);
  const recovered=new SaveQueue(disk,async d=>({version:d.version+1,...d.patch}),()=>{});
  try {recovered.recover((await disk.all())[0],4,{version:4});await recovered.flush('whiteboard:1');assert.equal(disk.data.size,0);}finally{recovered.stop();}
});
test('un conflicto nunca sobrescribe en reintentos y requiere resolución explícita',async()=>{
  const disk=storage();let attempts=0;let state:SaveState={status:'saved'};
  const remote={version:8,title:'Otra pestaña'};
  const queue=new SaveQueue(disk,async d=>{attempts++;if(d.version!==8)throw {status:409,current:remote,message:'Conflicto'};return {version:9,...d.patch};},(_,s)=>{state=s;});
  try {
    await queue.enqueue('document:1',3,{title:'Mi versión'});await queue.flush('document:1');
    assert.equal(state.status,'conflict');await queue.flush('document:1');assert.equal(attempts,1);assert.equal(disk.data.size,1);
    await queue.resolve('document:1',remote,true);assert.equal(attempts,2);assert.equal(disk.data.size,0);
  }finally{queue.stop();}
});
test('un borrador recuperado de una versión antigua se bloquea sin enviarse',async()=>{
  let sent=false;let state:SaveState={status:'saved'};
  const queue=new SaveQueue(storage(),async()=>{sent=true;return {};},(_,s)=>{state=s;});
  try{queue.recover({key:'document:1',version:1,patch:{title:'viejo'}},2,{version:2});await queue.flush('document:1');assert.equal(sent,false);assert.equal(state.status,'conflict');}finally{queue.stop();}
});
test('descartar un conflicto borra solo ese borrador y entrega la versión remota',async()=>{
  const disk=storage();let saved:Record<string,unknown>|undefined;
  const queue=new SaveQueue(disk,async()=>({}),(_key,_state,row)=>{saved=row;});
  try {
    await queue.enqueue('document:1',1,{title:'local'});await queue.enqueue('document:2',1,{title:'otro'});
    queue.recover(queue.pending()[0],2,{version:2,title:'servidor'});
    await queue.resolve('document:1',{version:2,title:'servidor'},false);
    assert.equal(disk.data.has('document:1'),false);assert.equal(disk.data.has('document:2'),true);assert.equal(saved?.title,'servidor');
  }finally{queue.stop();}
});
test('si falla limpiar el respaldo tras confirmar, no se envía un PATCH vacío',async()=>{
  const disk=storage();disk.remove=async()=>{throw new Error('Disco bloqueado');};
  let attempts=0,state:SaveState={status:'pending'};
  const queue=new SaveQueue(disk,async()=>{attempts++;return {version:2,title:'confirmado'};},(_,s)=>{state=s;});
  try{await queue.enqueue('document:1',1,{title:'confirmado'});await queue.flush('document:1');await queue.flush('document:1');assert.equal(attempts,1);assert.equal(state.status,'saved');assert.equal(queue.pending().length,0);}finally{queue.stop();}
});
