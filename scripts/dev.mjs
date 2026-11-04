import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const api=spawn(process.execPath,['--import','./backend/node_modules/tsx/dist/loader.mjs','backend/server.ts'],{cwd:root,stdio:'inherit'});
const ui=spawn(process.execPath,['node_modules/vite/bin/vite.js'],{cwd:root,stdio:'inherit'});
let stopping=false;
function stop(code=0){
  if(stopping)return;stopping=true;process.exitCode=code;
  api.kill();ui.kill();
}
for(const child of [api,ui]){
  child.on('error',error=>{console.error(error.message);stop(1);});
  child.on('exit',code=>stop(code||0));
}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
