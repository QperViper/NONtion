// Procesos de la API iniciados por el lanzador: el vigilante (logs/api.pid) y la API (logs/api-child.pid).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const supervisorPidFile = path.join(root, 'logs', 'api.pid');
export const childPidFile = path.join(root, 'logs', 'api-child.pid');

export const readPid = file => (existsSync(file) ? Number(readFileSync(file, 'utf8')) || 0 : 0);

export function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

/** Windows reutiliza números de proceso: solo se considera nuestro si sigue siendo un proceso de Node. */
export function isNode(pid) {
  if (!alive(pid)) return false;
  try {
    if (process.platform === 'win32') {
      return /^"node\.exe"/i.test(execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true }).trim());
    }
    if (existsSync(`/proc/${pid}/cmdline`)) return /node/.test(readFileSync(`/proc/${pid}/cmdline`, 'utf8'));
    return true;
  } catch { return false; }
}

/** Detiene primero el vigilante (para que no relance la API) y luego la API. */
export async function stopApi() {
  const stopped = [];
  for (const file of [supervisorPidFile, childPidFile]) {
    const pid = readPid(file);
    if (isNode(pid)) {
      try { process.kill(pid); stopped.push(pid); } catch { /* ya terminó */ }
    }
  }
  for (let i = 0; i < 40 && stopped.some(alive); i++) await new Promise(resolve => setTimeout(resolve, 250));
  rmSync(supervisorPidFile, { force: true });
  rmSync(childPidFile, { force: true });
  return stopped;
}
