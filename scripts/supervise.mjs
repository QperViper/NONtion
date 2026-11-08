// Vigilante de la API: la mantiene en marcha. Si el proceso se cae (corte de red, error inesperado,
// base de datos todavía no disponible al encender), lo vuelve a arrancar con esperas crecientes (2 s → 30 s).
// Lo inicia scripts/launch.mjs; scripts/stop.mjs lo detiene junto con la API.
import { spawn } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const childPidFile = path.join(root, 'logs', 'api-child.pid');
const stamp = () => new Date().toLocaleString('es');
let child = null, stopping = false, delay = 2000;

function start() {
  const startedAt = Date.now();
  child = spawn(process.execPath, ['--import', './backend/node_modules/tsx/dist/loader.mjs', 'backend/server.ts', ...process.argv.slice(2)],
    { cwd: root, stdio: 'inherit', windowsHide: true });
  writeFileSync(childPidFile, String(child.pid));
  child.on('exit', (code, signal) => {
    if (stopping) return;
    // Si llevaba más de un minuto funcionando, fue un fallo puntual: se reinicia rápido.
    if (Date.now() - startedAt > 60_000) delay = 2000;
    console.error(`[${stamp()}] La API se detuvo (${signal || `código ${code}`}). Se reinicia en ${delay / 1000} s.`);
    setTimeout(start, delay);
    delay = Math.min(delay * 2, 30_000);
  });
}

function stop() {
  stopping = true;
  child?.kill();
  rmSync(childPidFile, { force: true });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
start();
