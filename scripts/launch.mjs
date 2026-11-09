// Lanzador de nontion: un clic (o el inicio de Windows) deja la app lista.
//   node scripts/launch.mjs            abre la app (arranca la API si hace falta)
//   node scripts/launch.mjs --startup  igual, con más paciencia (al encender el equipo la red tarda)
//   node scripts/launch.mjs --no-open  solo deja la API en marcha
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isNode, readPid, stopApi, supervisorPidFile } from './api-process.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const logs = path.join(root, 'logs');
const pidFile = path.join(logs, 'api.pid');
const args = new Set(process.argv.slice(2));
const startup = args.has('--startup');
mkdirSync(logs, { recursive: true });

const env = readEnv(path.join(root, 'backend', '.env'));
const port = Number(process.env.PORT || env.PORT || 4000);
const appUrl = `http://127.0.0.1:${port}/`;
const launcherLog = path.join(logs, 'lanzador.log');

function log(...parts) {
  const line = `[${new Date().toLocaleString('es')}] ${parts.join(' ')}`;
  console.log(line);
  try { writeFileSync(launcherLog, line + '\n', { flag: 'a' }); } catch { /* el registro no debe impedir el arranque */ }
}

function readEnv(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (match) out[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let apiStartedAt = 0;
/** 'ok' = API y base listas, 'db' = API en marcha pero sin base de datos, null = no responde. */
async function health() {
  try {
    const response = await fetch(`${appUrl}api/health`, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return 'db';
    apiStartedAt = Number((await response.json().catch(() => ({}))).startedAt) || 0;
    return 'ok';
  } catch { return null; }
}

/** Código más nuevo que la API en marcha (por ejemplo, tras un git pull): hay que reiniciarla. */
function codeChangedSince(time) {
  const watched = ['src', 'public', 'index.html', 'vite.config.ts', 'package.json', 'pnpm-lock.yaml', 'backend'].map(p => path.join(root, p));
  const newest = Math.max(...watched.map(target => target.endsWith('backend')
    ? Math.max(...readdirSync(target).filter(n => n !== 'node_modules' && n !== 'data' && n !== 'backups').map(n => newestMtime(path.join(target, n))))
    : newestMtime(target)));
  return newest > time;
}

async function restartIfOutdated() {
  if (!apiStartedAt || !codeChangedSince(apiStartedAt) || !isNode(readPid(supervisorPidFile))) return false;
  log('El código cambió desde que arrancó la API: reiniciando…');
  // Se espera a que los procesos terminen de verdad (no basta con que dejen de aceptar conexiones nuevas).
  await stopApi();
  apiStartedAt = 0;
  return true;
}

function newestMtime(target) {
  if (!existsSync(target)) return 0;
  const info = statSync(target);
  if (!info.isDirectory()) return info.mtimeMs;
  let newest = 0;
  for (const name of readdirSync(target)) newest = Math.max(newest, newestMtime(path.join(target, name)));
  return newest;
}

/** Compila la interfaz solo si el código cambió desde el último build. */
function ensureBuild() {
  const index = path.join(root, 'dist', 'index.html');
  const sources = ['src', 'public', 'index.html', 'vite.config.ts', 'package.json', 'tsconfig.app.json'].map(p => path.join(root, p));
  const built = existsSync(index) ? statSync(index).mtimeMs : 0;
  if (built && Math.max(...sources.map(newestMtime)) <= built) return;
  log(built ? 'El código cambió: recompilando la interfaz…' : 'Primera vez: compilando la interfaz…');
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--logLevel', 'warn'],
    { cwd: root, encoding: 'utf8', windowsHide: true });
  writeFileSync(path.join(logs, 'build.log'), `${result.stdout || ''}\n${result.stderr || ''}`);
  if (result.status !== 0) throw new Error('No se pudo compilar la interfaz. El detalle está en logs/build.log.');
}

/** Tras un `git pull` con dependencias nuevas, las instala antes de compilar (una vez por cambio del lockfile). */
function ensureDependencies() {
  for (const dir of [root, path.join(root, 'backend')]) {
    const lock = path.join(dir, 'pnpm-lock.yaml');
    const marker = path.join(dir, 'node_modules', '.nontion-instalado');
    if (!existsSync(lock)) continue;
    const installed = Math.max(...[marker, path.join(dir, 'node_modules', '.modules.yaml')].map(f => existsSync(f) ? statSync(f).mtimeMs : 0));
    if (installed && statSync(lock).mtimeMs <= installed) continue;
    log(`Instalando dependencias en ${path.relative(root, dir) || 'la raíz'}…`);
    const result = spawnSync('pnpm', ['install', '--frozen-lockfile'], { cwd: dir, encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' });
    writeFileSync(path.join(logs, 'install.log'), `${result.stdout || ''}\n${result.stderr || ''}${result.error ? `\n${result.error.message}` : ''}`);
    if (result.status !== 0) throw new Error(`No se pudieron instalar las dependencias (¿pnpm está instalado?). Detalle en logs/install.log. También puedes ejecutar "pnpm install" en ${dir}.`);
    writeFileSync(marker, new Date().toISOString());
  }
}

/** Arranca el vigilante, que a su vez arranca la API y la relanza si se cae. */
function startApi() {
  const out = openSync(path.join(logs, 'api.log'), 'a');
  const child = spawn(process.execPath, [path.join(root, 'scripts', 'supervise.mjs'), '--ui'], {
    cwd: root, detached: true, windowsHide: true, stdio: ['ignore', out, out],
  });
  child.unref();
  writeFileSync(pidFile, String(child.pid));
  log(`API iniciada con vigilante (pid ${child.pid}).`);
  return child.pid;
}

/** Brave → Chrome → Edge, en modo ventana de aplicación (sin pestañas ni barra de direcciones). */
function findBrowser() {
  const preferred = process.env.NONTION_BROWSER || env.NONTION_BROWSER;
  if (preferred && existsSync(preferred)) return preferred;
  if (process.platform !== 'win32') return null;
  const bases = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean);
  const candidates = [
    ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'],
    ['Google', 'Chrome', 'Application', 'chrome.exe'],
    ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
  ];
  for (const parts of candidates) for (const base of bases) {
    const exe = path.join(base, ...parts);
    if (existsSync(exe)) return exe;
  }
  return null;
}

function openDefault(url, options) {
  const child = process.platform === 'win32'
    ? spawn('cmd', ['/c', 'start', '""', url], { ...options, windowsHide: true })
    : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], options);
  child.on('error', error => log('Tampoco se pudo abrir el navegador predeterminado:', error.message));
  child.unref();
}

/** Abre la ventana y deja constancia en lanzador.log; si el navegador falla, usa el predeterminado. */
function open(url) {
  if (args.has('--no-open')) return;
  const browser = findBrowser();
  const options = { detached: true, stdio: 'ignore', windowsHide: false };
  if (!browser) { log('Abriendo en el navegador predeterminado:', url); openDefault(url, options); return; }
  log(`Abriendo ventana: ${browser} --app=${url}`);
  const child = spawn(browser, [`--app=${url}`], options);
  let fellBack = false;
  const fallback = reason => {
    if (fellBack) return; fellBack = true;
    log(`El navegador no abrió la ventana (${reason}). Se usa el navegador predeterminado.`);
    openDefault(url, options);
  };
  child.on('error', error => fallback(error.message));
  // Si ya hay un Brave abierto, este proceso le pasa la orden y termina con código 0: es lo normal.
  child.on('exit', code => { if (code) fallback(`código ${code}`); });
  // Se espera unos segundos a ver si falla antes de que el lanzador termine.
  setTimeout(() => child.unref(), 4000);
}

/** Si algo falla, se muestra una página con el motivo en vez de una ventana negra que desaparece. */
function showProblem(title, detail) {
  log('PROBLEMA:', title, detail);
  const escape = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const file = path.join(logs, 'estado.html');
  writeFileSync(file, `<!doctype html><html lang="es"><meta charset="utf-8"><title>nontion · no pudo arrancar</title>
<style>body{font:16px/1.6 system-ui,sans-serif;background:#191919;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
main{max-width:640px}h1{font-size:22px}code{background:#2a2a2a;padding:2px 6px;border-radius:4px}p.muted{color:#999}</style>
<main><h1>${escape(title)}</h1><p>${escape(detail)}</p>
<p class="muted">Registros: <code>${escape(logs)}</code> (api.log, lanzador.log). Cuando lo soluciones, vuelve a abrir nontion desde su acceso directo.</p></main></html>`);
  open(pathToFileURL(file).href);
  process.exitCode = 1;
}

/** Archivos que quedaron de versiones anteriores y ya no se usan: se borran solos. */
const OBSOLETE = ['backend/sideBrowser.ts', 'backend/tests/sideBrowser.test.ts'];
function removeObsolete() {
  for (const file of OBSOLETE) {
    const full = path.join(root, file);
    if (existsSync(full)) { try { rmSync(full); log(`Archivo obsoleto borrado: ${file}`); } catch (error) { log(`No se pudo borrar ${file}: ${error.message}`); } }
  }
}

async function main() {
  log(`Lanzador ${startup ? '(inicio de Windows)' : ''}`.trim());
  removeObsolete();
  if (!existsSync(path.join(root, 'node_modules')) || !existsSync(path.join(root, 'backend', 'node_modules'))) {
    return showProblem('Faltan las dependencias', 'Abre una terminal en la carpeta del proyecto y ejecuta: pnpm install  y luego  pnpm --dir backend install');
  }
  if (!existsSync(path.join(root, 'backend', '.env'))) {
    return showProblem('Falta backend/.env', 'Copia backend/.env.example a backend/.env y escribe tu DATABASE_URL.');
  }
  let state = await health();
  if (state === 'ok' && await restartIfOutdated()) state = null;
  if (state === 'ok') { log('La API ya estaba en marcha.'); open(appUrl); return; }
  if (state === null) {
    try { ensureDependencies(); } catch (error) { return showProblem('Faltan dependencias', error.message); }
    try { ensureBuild(); } catch (error) { return showProblem('La interfaz no compiló', error.message); }
  }
  // Al encender el equipo la base de datos o la red pueden tardar: se reintenta con paciencia.
  const deadline = Date.now() + (startup ? 180_000 : 60_000);
  // Si el vigilante ya está en marcha (por ejemplo, esperando a que vuelva internet), no se lanza otro.
  let pid = isNode(readPid(supervisorPidFile)) ? readPid(supervisorPidFile) : 0;
  while (Date.now() < deadline) {
    state = await health();
    if (state === 'ok') { log('Lista en', appUrl); open(appUrl); return; }
    if (state === null && !isNode(pid)) pid = startApi();
    await sleep(1500);
  }
  if (state === 'db') return showProblem('La base de datos no responde', 'La API está en marcha, pero no logra conectarse a la base de datos. Revisa la conexión a internet de este equipo y la DATABASE_URL de backend/.env. nontion sigue reintentando solo: cuando vuelva la conexión, abre de nuevo el acceso directo.');
  let last = '';
  try { last = readFileSync(path.join(logs, 'api.log'), 'utf8').trim().split(/\r?\n/).filter(line => !/La API se detuvo/.test(line)).pop() || ''; } catch { /* sin registro todavía */ }
  showProblem('La API no arrancó', `${last ? `Último mensaje: «${last}». ` : ''}Suele deberse a la DATABASE_URL, a que la base de datos o internet no están disponibles, o a otro programa usando el puerto ${port}. nontion sigue reintentando solo en segundo plano.`);
}

main().catch(error => showProblem('Error inesperado del lanzador', error.stack || error.message));
