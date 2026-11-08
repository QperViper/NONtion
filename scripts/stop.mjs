// Detiene la API que inició el lanzador (scripts/launch.mjs).
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pidFile = path.join(root, 'logs', 'api.pid');
const envFile = path.join(root, 'backend', '.env');
const port = Number(process.env.PORT || (existsSync(envFile) && readFileSync(envFile, 'utf8').match(/^\s*PORT\s*=\s*(\d+)/m)?.[1]) || 4000);
const pid = existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8')) : 0;

// Solo se detiene el pid guardado si la API sigue respondiendo: Windows reutiliza números de proceso.
const running = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(3000) }).then(() => true, () => false);
if (!pid || !running) {
  console.log(running ? `Hay una API en el puerto ${port}, pero no la inició el lanzador (¿npm run dev?).` : 'nontion no estaba en marcha.');
} else {
  try { process.kill(pid); rmSync(pidFile, { force: true }); console.log(`nontion detenido (pid ${pid}).`); }
  catch (error) { console.log(`No se pudo detener: ${error.message}`); }
}
if (!running) rmSync(pidFile, { force: true });
