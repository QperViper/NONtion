import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, rename, stat, unlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Cámara del celular → disco de este equipo (carpeta FONion), sin pasar por la nube.
 * Mientras la recepción está activa, un servidor aparte escucha en la red local o en la red del cable
 * («Compartir Internet» del iPhone) y SOLO acepta: la página del celular y la subida de fotos/videos,
 * ambas detrás de un código secreto que cambia cada vez. La API principal sigue solo en 127.0.0.1.
 */
export const captureDir = () => process.env.NONTION_CAPTURE_DIR || path.join(os.homedir(), 'Pictures', 'FONion');
const PORT = () => Number(process.env.NONTION_CAPTURE_PORT || 4100);
const MAX_BYTES = 8 * 1024 ** 3;            // 8 GB por archivo (videos largos en 4K)
const IDLE_MS = 15 * 60_000;                 // se apaga sola tras 15 min sin uso
export const EXTENSIONS: Record<string, 'image' | 'video'> = {
  jpg: 'image', jpeg: 'image', png: 'image', heic: 'image', heif: 'image', webp: 'image', gif: 'image',
  mov: 'video', mp4: 'video', m4v: 'video', '3gp': 'video',
};
const TYPE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/heif': 'heif', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/quicktime': 'mov', 'video/mp4': 'mp4', 'video/x-m4v': 'm4v', 'video/3gpp': '3gp',
};

let server: Server | null = null;
let token = '';
let lastUse = 0;
let idleTimer: NodeJS.Timeout | null = null;
const received: { file: string; at: number }[] = [];

export interface Address { label: string; iface: string; url: string; }
/** Direcciones por las que el celular puede llegar a este equipo. Primero la del cable del iPhone. */
export function addresses(port = PORT(), secret = token): Address[] {
  const out: (Address & { rank: number })[] = [];
  for (const [iface, list] of Object.entries(os.networkInterfaces())) {
    if (/vethernet|virtualbox|vmware|wsl|hyper-v|loopback|docker|tailscale|zerotier|vpn/i.test(iface)) continue;
    for (const net of list ?? []) {
      if (net.family !== 'IPv4' || net.internal || net.address.startsWith('169.254.')) continue;
      const tether = net.address.startsWith('172.20.10.') || /apple|iphone/i.test(iface);
      const label = tether ? 'iPhone por cable o Wi-Fi del iPhone (Compartir Internet)' : /wi-?fi|wlan|inal[aá]mbrica|wireless/i.test(iface) ? 'Misma red Wi-Fi' : 'Red local';
      out.push({ label, iface, url: `http://${net.address}:${port}/c/${secret}`, rank: tether ? 0 : /wi-?fi|wlan|wireless/i.test(iface) ? 1 : 2 });
    }
  }
  return out.sort((a, b) => a.rank - b.rank).map(({ rank: _rank, ...a }) => a);
}

/** «IMG_0042.JPG», tipo → nombre seguro y extensión permitida. null si no es foto o video. */
export function safeName(original: string, type: string) {
  const base = path.basename(original || '').replace(/\.[^.]*$/, '').normalize('NFC').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 60) || 'captura';
  const fromName = path.extname(original || '').slice(1).toLowerCase();
  const ext = EXTENSIONS[fromName] ? fromName : TYPE_EXT[type.split(';')[0].trim().toLowerCase()];
  return ext ? { base, ext, kind: EXTENSIONS[ext] } : null;
}

const pad = (n: number) => String(n).padStart(2, '0');
async function destination(base: string, ext: string, now = new Date()) {
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const dir = path.join(captureDir(), day);
  await mkdir(dir, { recursive: true });
  const stamp = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  for (let i = 1; ; i++) {
    const name = `${stamp}_${base}${i > 1 ? `-${i}` : ''}.${ext}`;
    if (!existsSync(path.join(dir, name))) return { full: path.join(dir, name), rel: `${day}/${name}` };
  }
}

function sameSecret(given: string) {
  const a = Buffer.from(given), b = Buffer.from(token);
  return token.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}
function touch() {
  lastUse = Date.now();
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (Date.now() - lastUse >= IDLE_MS) void stopCapture(); }, IDLE_MS + 1000);
  idleTimer.unref();
}
function send(res: ServerResponse, status: number, body: string, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
  res.end(body);
}

async function upload(req: IncomingMessage, res: ServerResponse) {
  let name = '';
  try { name = decodeURIComponent(String(req.headers['x-file-name'] || '')); } catch { /* nombre inválido: se usa el genérico */ }
  const target = safeName(name, String(req.headers['content-type'] || ''));
  if (!target) return send(res, 415, JSON.stringify({ error: 'Solo se aceptan fotos y videos.' }));
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > MAX_BYTES) return send(res, 413, JSON.stringify({ error: 'Archivo demasiado grande (máximo 8 GB).' }));
  const { full, rel } = await destination(target.base, target.ext);
  const partial = `${full}.parcial`;
  let bytes = 0;
  const limit = new Transform({ transform(chunk: Buffer, _enc, done) { bytes += chunk.length; done(bytes > MAX_BYTES ? new Error('demasiado grande') : null, chunk); } });
  try {
    await pipeline(req, limit, createWriteStream(partial, { flags: 'wx' }));
    if (!bytes) throw new Error('vacío');
    await rename(partial, full);
  } catch (error) {
    await unlink(partial).catch(() => {});
    if (!res.headersSent) send(res, 400, JSON.stringify({ error: `No se pudo guardar (${(error as Error).message}).` }));
    return;
  }
  received.unshift({ file: rel, at: Date.now() });
  received.splice(200);
  touch();
  send(res, 201, JSON.stringify({ file: rel, bytes, kind: target.kind }));
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const match = (req.url || '').match(/^\/c\/([\w-]{20,64})(\/upload|\/ping)?\/?(\?.*)?$/);
  // Cualquier otra ruta, o un código equivocado, recibe lo mismo: 404 sin pistas.
  if (!match || !sameSecret(match[1])) return send(res, 404, 'No encontrado', 'text/plain; charset=utf-8');
  const action = match[2];
  if (!action && req.method === 'GET') { touch(); return send(res, 200, mobilePage(), 'text/html; charset=utf-8'); }
  if (action === '/ping' && req.method === 'GET') { touch(); return send(res, 200, JSON.stringify({ ok: true, host: os.hostname() })); }
  if (action === '/upload' && req.method === 'POST') return upload(req, res);
  return send(res, 405, JSON.stringify({ error: 'Método no permitido.' }));
}

export async function startCapture() {
  if (server) { touch(); return; }
  token = randomBytes(18).toString('base64url');
  const instance = createServer((req, res) => { handle(req, res).catch(() => { if (!res.headersSent) send(res, 500, JSON.stringify({ error: 'Error inesperado.' })); }); });
  instance.requestTimeout = 0; // subidas de video largas
  instance.headersTimeout = 30_000;
  await new Promise<void>((resolve, reject) => {
    instance.once('error', reject);
    instance.listen(PORT(), process.env.NONTION_CAPTURE_HOST || '0.0.0.0', () => resolve());
  });
  server = instance;
  touch();
  console.log(`Cámara: recibiendo fotos y videos en el puerto ${PORT()} → ${captureDir()}`);
}

export async function stopCapture() {
  const instance = server;
  server = null; token = '';
  if (idleTimer) clearTimeout(idleTimer);
  if (!instance) return;
  instance.closeAllConnections();
  await new Promise<void>(resolve => instance.close(() => resolve()));
  console.log('Cámara: recepción detenida.');
}

export interface CaptureFile { file: string; name: string; kind: 'image' | 'video'; bytes: number; at: number; }
/** Lo recibido en los últimos días (los más nuevos primero). */
export async function recentFiles(limit = 60): Promise<CaptureFile[]> {
  const root = captureDir();
  if (!existsSync(root)) return [];
  const days = (await readdir(root)).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse().slice(0, 7);
  const out: CaptureFile[] = [];
  for (const day of days) {
    for (const name of await readdir(path.join(root, day))) {
      const kind = EXTENSIONS[path.extname(name).slice(1).toLowerCase()];
      if (!kind) continue;
      const info = await stat(path.join(root, day, name));
      out.push({ file: `${day}/${name}`, name, kind, bytes: info.size, at: info.mtimeMs });
    }
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => b.at - a.at).slice(0, limit);
}

/** Ruta en disco de un archivo recibido, validando que no se salga de la carpeta FONion. */
export function resolveCapture(rel: unknown): string | null {
  if (typeof rel !== 'string' || !/^\d{4}-\d{2}-\d{2}\/[^/\\]+$/.test(rel) || rel.includes('..')) return null;
  const full = path.resolve(captureDir(), rel);
  return full.startsWith(path.resolve(captureDir()) + path.sep) && EXTENSIONS[path.extname(full).slice(1).toLowerCase()] ? full : null;
}

export async function captureStatus() {
  if (server) touch();
  return {
    active: Boolean(server), port: PORT(), dir: captureDir(),
    path: server ? `/c/${token}` : null,
    addresses: server ? addresses() : [],
    files: await recentFiles(),
    receivedThisSession: received.length,
  };
}

/** Página que se abre en el celular: sin dependencias externas, pensada para Safari del iPhone. */
function mobilePage() {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#191919"><title>Enviar a ${os.hostname().replace(/[<>&"]/g, '')}</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;font:16px/1.45 -apple-system,system-ui,sans-serif;background:#191919;color:#ececf0;padding:20px 16px calc(24px + env(safe-area-inset-bottom))}
h1{font-size:22px;margin:4px 0 2px}p.sub{margin:0 0 20px;color:#9a9aa5;font-size:14px}
.btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:18px;border-radius:14px;font-size:18px;font-weight:600;border:0;margin-bottom:12px;color:#fff;background:#2383e2}
.btn.alt{background:#2a2a31;border:1px solid #3a3a44}.btn input{display:none}
ul{list-style:none;padding:0;margin:18px 0 0}li{background:#222228;border:1px solid #303038;border-radius:12px;padding:10px 12px;margin-bottom:8px;font-size:14px}
.row{display:flex;justify-content:space-between;gap:8px}.name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.state{color:#9a9aa5;flex-shrink:0}
.ok{color:#5fd29a}.err{color:#ff8a8a}.bar{height:5px;background:#33333b;border-radius:9px;margin-top:8px;overflow:hidden}.bar i{display:block;height:100%;width:0;background:#2383e2;transition:width .2s}
#net{font-size:13px;color:#9a9aa5;margin-top:14px;text-align:center}
</style></head><body>
<h1>Enviar al PC</h1><p class="sub">Se guarda en la carpeta FONion de <b>${os.hostname().replace(/[<>&"]/g, '')}</b>. Nada pasa por internet.</p>
<label class="btn">📷 Tomar foto o video<input id="cam" type="file" accept="image/*,video/*" capture="environment"></label>
<label class="btn alt">🖼️ Elegir de Fotos<input id="lib" type="file" accept="image/*,video/*" multiple></label>
<ul id="list"></ul><div id="net">Conectado</div>
<script>
const base=location.pathname.replace(/\\/$/,'');const list=document.getElementById('list');const queue=[];let busy=false;
const fmt=b=>b>1e9?(b/1e9).toFixed(2)+' GB':b>1e6?(b/1e6).toFixed(1)+' MB':Math.round(b/1e3)+' KB';
function add(files){for(const f of files){const li=document.createElement('li');li.innerHTML='<div class="row"><span class="name"></span><span class="state">En cola · '+fmt(f.size)+'</span></div><div class="bar"><i></i></div>';li.querySelector('.name').textContent=f.name||'captura';list.prepend(li);queue.push({f,li});}next();}
function next(){if(busy||!queue.length)return;busy=true;const {f,li}=queue.shift();const st=li.querySelector('.state'),bar=li.querySelector('.bar i');
const x=new XMLHttpRequest();x.open('POST',base+'/upload');x.setRequestHeader('Content-Type',f.type||'application/octet-stream');x.setRequestHeader('X-File-Name',encodeURIComponent(f.name||''));
x.upload.onprogress=e=>{if(e.lengthComputable){const p=Math.round(e.loaded/e.total*100);bar.style.width=p+'%';st.textContent=p+'%';}};
x.onload=()=>{busy=false;if(x.status===201){bar.style.transition='none';bar.style.width='100%';bar.style.background='#5fd29a';st.textContent='✓ Guardado';st.className='state ok';}else{let m='Error';try{m=JSON.parse(x.responseText).error}catch(e){}st.textContent=m;st.className='state err';}next();};
x.onerror=()=>{busy=false;st.textContent='Sin conexión con el PC';st.className='state err';next();};x.send(f);}
for(const id of ['cam','lib'])document.getElementById(id).addEventListener('change',e=>{add([...e.target.files]);e.target.value='';});
setInterval(()=>fetch(base+'/ping').then(r=>{document.getElementById('net').textContent=r.ok?'Conectado':'El PC detuvo la recepción'}).catch(()=>{document.getElementById('net').textContent='Sin conexión con el PC'}),5000);
</script></body></html>`;
}
