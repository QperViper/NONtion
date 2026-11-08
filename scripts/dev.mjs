import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const port=Number(process.env.PORT||4000);
// Si nontion ya está abierto (lanzador o inicio de Windows), se reutiliza esa API en vez de chocar por el puerto.
const running=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(2000)}).then(()=>true,()=>false);
if(running)console.log(`Usando la API que ya está en marcha en el puerto ${port}. Para que tome cambios del backend, detenla con "npm run stop".`);
const children=[];
if(!running)children.push(spawn(process.execPath,['--import','./backend/node_modules/tsx/dist/loader.mjs','backend/server.ts'],{cwd:root,stdio:'inherit'}));
children.push(spawn(process.execPath,['node_modules/vite/bin/vite.js'],{cwd:root,stdio:'inherit'}));
let stopping=false;
function stop(code=0){
  if(stopping)return;stopping=true;process.exitCode=code;
  for(const child of children)child.kill();
}
for(const child of children){
  child.on('error',error=>{console.error(error.message);stop(1);});
  child.on('exit',code=>stop(code||0));
}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
