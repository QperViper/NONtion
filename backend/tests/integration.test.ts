import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';

test('API y PostgreSQL: persistencia, versiones, hiperhilos, papelera y archivos', {skip:process.env.NONTION_INTEGRATION!=='1'},async t=>{
  const {app}=await import('../app.ts');const {pool}=await import('../db.ts');
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.on('listening',resolve));
  const address=server.address();assert.ok(address&&typeof address==='object');
  const base=`http://127.0.0.1:${address.port}`;
  const docs:string[]=[],boards:string[]=[],threads:string[]=[],assets:string[]=[];
  const call=async(path:string,method='GET',body?:unknown)=>{
    const res=await fetch(`${base}/api${path}`,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
    return {status:res.status,data:await res.json()};
  };
  try {
    const doc=await call('/documents','POST',{title:'QA API temporal'});assert.equal(doc.status,201);docs.push(doc.data.id);
    const id=doc.data.id;
    await t.test('solo una escritura con la misma versión puede confirmar',async()=>{
      const outcomes=await Promise.all([call(`/documents/${id}`,'PATCH',{version:1,title:'A'}),call(`/documents/${id}`,'PATCH',{version:1,title:'B'})]);
      assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,409]);
      const conflict=outcomes.find(r=>r.status===409)!;assert.equal(conflict.data.current.version,2);
      const saved=await call(`/documents/${id}`,'PATCH',{version:2,title:'QA API temporal',content:[{id:'qa-block',type:'paragraph',props:{},content:[{type:'text',text:'Persistente',styles:{}}],children:[]}]});
      assert.equal(saved.status,200);assert.equal(saved.data.content,undefined,'PATCH no repite el contenido');
      const full=await call(`/documents/${id}`);assert.equal(full.status,200);assert.equal(full.data.content[0].content[0].text,'Persistente');
    });
    const board=await call('/whiteboards','POST',{title:'QA API lienzo'});assert.equal(board.status,201);boards.push(board.data.id);
    await t.test('un snapshot JSONB se conserva íntegro',async()=>{
      const snapshot={document:{schema:{schemaVersion:2,sequences:{}},store:{'page:qa':{id:'page:qa',typeName:'page',name:'QA'}}}};
      const result=await call(`/whiteboards/${board.data.id}`,'PATCH',{version:1,snapshot});assert.equal(result.status,200);assert.equal(result.data.snapshot,undefined);
      assert.deepEqual((await call(`/whiteboards/${board.data.id}`)).data.snapshot,snapshot);
    });
    await t.test('conexión estable, creación idempotente y papelera reversible',async()=>{
      const threadId=randomUUID();threads.push(threadId);
      const connection={id:threadId,sourceDocId:id,sourceText:'Persistente',sourceBlockId:'qa-block',destinationType:'whiteboard',destinationId:board.data.id};
      const saved=await call('/connections','POST',connection);assert.equal(saved.status,201);assert.equal(saved.data.destination_id,board.data.id);
      const repeated=await call('/connections','POST',connection);assert.equal(repeated.data.id,threadId);
      const removed=await call(`/whiteboards/${board.data.id}`,'PATCH',{version:2,deletedAt:new Date().toISOString()});assert.equal(removed.status,200);assert.ok(removed.data.deleted_at);
      const denied=await call('/connections','POST',{...connection,id:randomUUID()});assert.equal(denied.status,404);
      const restored=await call(`/whiteboards/${board.data.id}`,'PATCH',{version:3,deletedAt:null});assert.equal(restored.status,200);assert.equal(restored.data.deleted_at,null);
      const bootstrap=await call('/bootstrap');assert.equal(bootstrap.status,200);assert.equal(bootstrap.data.connections.filter((c:{id:string})=>c.id===threadId).length,1);
    });
    await t.test('sincronización: arranque liviano, cambios desde un cursor y escrituras que confirman tarde',async()=>{
      const boot=await call('/bootstrap');assert.match(boot.data.cursor,/^\d+$/);
      const mine=boot.data.documents.find((d:{id:string})=>d.id===id);
      assert.equal(mine.content,undefined,'el arranque no trae contenido');assert.ok(Array.isArray(mine.thread_links));
      assert.equal(boot.data.whiteboards.find((b:{id:string})=>b.id===board.data.id).snapshot,undefined);
      let cursor=boot.data.cursor;
      const quiet=await call(`/changes?since=${cursor}`);
      assert.equal(quiet.status,200);cursor=quiet.data.cursor;
      const before=await call(`/documents/${id}`);
      const linked=[{id:'qa-link',type:'paragraph',props:{},content:[{type:'link',href:'/hilo/qa-123',content:[{type:'text',text:'x',styles:{}}]}],children:[]}];
      const edited=await call(`/documents/${id}`,'PATCH',{version:before.data.version,content:linked});assert.deepEqual(edited.data.thread_links,['/hilo/qa-123']);
      const changed=await call(`/changes?since=${cursor}`);
      assert.deepEqual(changed.data.documents.map((d:{id:string})=>d.id),[id]);assert.equal(changed.data.documents[0].content,undefined);
      assert.deepEqual(changed.data.whiteboards,[]);cursor=changed.data.cursor;
      // Otro equipo abre una transacción, escribe y confirma DESPUÉS de que este consulte.
      const other=await pool.connect();
      try {
        await other.query('BEGIN');await other.query("UPDATE whiteboards SET name='QA tarde' WHERE id=$1",[board.data.id]);
        const during=await call(`/changes?since=${cursor}`);
        assert.equal(during.data.whiteboards.length,0,'lo no confirmado todavía no se ve');
        await other.query('COMMIT');
        const after=await call(`/changes?since=${during.data.cursor}`);
        assert.deepEqual(after.data.whiteboards.map((b:{name:string})=>b.name),['QA tarde'],'no se pierde aunque confirmó tarde');
      } finally { other.release(); }
      assert.equal((await call('/changes?since=abc')).status,400);
      assert.equal((await call(`/whiteboards/no-existe-${randomUUID()}`)).status,404);
    });
    await t.test('un corte de la base (como los de Supabase) no tumba la API y reconecta sola',async()=>{
      const admin=new (await import('pg')).default.Client({connectionString:process.env.DATABASE_URL});await admin.connect();
      try {
        // Peticiones en curso mientras se cortan todas las conexiones de la app.
        const inFlight=Promise.all([call('/bootstrap'),call(`/documents/${id}`),call('/changes?since=1')]);
        await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='nontion' AND pid<>pg_backend_pid()");
        const statuses=(await inFlight).map(r=>r.status);
        assert.ok(statuses.every(s=>s===200||s===500),`respuestas: ${statuses}`);
        await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='nontion' AND pid<>pg_backend_pid()");
        await new Promise(r=>setTimeout(r,200));
        const after=await call('/bootstrap');assert.equal(after.status,200,'tras el corte vuelve a funcionar');
      } finally { await admin.end(); }
    });
    await t.test('errores HTTP explícitos para entradas y recursos inválidos',async()=>{
      assert.equal((await call(`/documents/${id}`,'PATCH',{title:'sin versión'})).status,400);
      assert.equal((await call(`/documents/${randomUUID()}`,'PATCH',{version:1,title:'ausente'})).status,404);
      assert.equal((await call(`/documents/${id}`,'PATCH',{version:3,content:'texto'})).status,400);
    });
    await t.test('GIF subido sigue accesible y formatos falsos se rechazan',async()=>{
      const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
      const upload=await fetch(`${base}/api/assets`,{method:'POST',headers:{'Content-Type':'image/gif'},body:gif});
      assert.equal(upload.status,201);const result=await upload.json();assets.push(result.url);
      const fetched=await fetch(`${base}${result.url}`);assert.equal(fetched.status,200);assert.deepEqual(Buffer.from(await fetched.arrayBuffer()),gif);
      const bad=await fetch(`${base}/api/assets`,{method:'POST',headers:{'Content-Type':'image/png'},body:'not png'});assert.equal(bad.status,400);
    });
  } finally {
    // Only generated fixture IDs are removed. User documents and settings are untouched.
    for(const id of threads)await pool.query('DELETE FROM hyperthreads WHERE id=$1',[id]);
    for(const id of docs)await pool.query('DELETE FROM documents WHERE id=$1',[id]);
    for(const id of boards)await pool.query('DELETE FROM whiteboards WHERE id=$1',[id]);
    for(const path of assets)if(/^\/assets\/[0-9a-f-]+\.gif$/.test(path))await unlink(new URL(`../data${path}`,import.meta.url)).catch(()=>{});
    await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();
  }
});
