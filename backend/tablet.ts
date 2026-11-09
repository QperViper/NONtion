import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Tablet Android por USB. Con la depuración USB activada, `adb reverse` hace que en la tablet
 * http://localhost:4000 llegue a la API de este equipo por el cable (sin Wi-Fi ni red).
 * El enlace se pierde al desconectar, así que se vigila cada pocos segundos y se rehace solo.
 */
export function findAdb(): string | null {
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const candidates = [
    process.env.NONTION_ADB,
    ...(process.env.PATH || '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, exe)),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'nontion', 'platform-tools', exe),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', exe),
    process.env.HOME && path.join(process.env.HOME, 'Android', 'Sdk', 'platform-tools', exe),
  ];
  return candidates.find((file): file is string => Boolean(file && existsSync(file))) ?? null;
}

function adb(file: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(file, args, { timeout: 15_000, windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || error.message).trim())); else resolve(stdout);
    });
  });
}

export type TabletState = 'device' | 'unauthorized' | 'offline' | string;
export function parseDevices(output: string): Map<string, TabletState> {
  const devices = new Map<string, TabletState>();
  for (const line of output.split(/\r?\n/).slice(1)) {
    const [serial, state] = line.trim().split(/\s+/);
    if (serial && state) devices.set(serial, state);
  }
  return devices;
}

export interface TabletWatcher { stop(): void; check(): Promise<void>; linked(): string[]; }

export function watchTablets({ port, adbPath = findAdb(), intervalMs = 3000, openPath = '/pizarra', log = console.log }:
  { port: number; adbPath?: string | null; intervalMs?: number; openPath?: string | null; log?: (...parts: unknown[]) => void }): TabletWatcher | null {
  if (!adbPath) return null;
  const linked = new Set<string>();
  const warned = new Set<string>();
  let running: Promise<void> | null = null;
  // Una sola consulta a la vez; quien llega mientras otra corre espera esa misma.
  const check = () => running ??= run().finally(() => { running = null; });
  const run = async () => {
    try {
      const devices = parseDevices(await adb(adbPath, ['devices']));
      for (const serial of [...linked]) if (devices.get(serial) !== 'device') { linked.delete(serial); log(`Tablet desconectada (${serial}).`); }
      for (const [serial, state] of devices) {
        if (state === 'unauthorized' && !warned.has(serial)) {
          warned.add(serial);
          log(`Tablet ${serial} conectada, pero falta autorizar: acepta "¿Permitir depuración por USB?" en la pantalla de la tablet.`);
        }
        if (state !== 'device' || linked.has(serial)) continue;
        try { await adb(adbPath, ['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`]); }
        catch (error) {
          if (!warned.has(`reverse:${serial}`)) { warned.add(`reverse:${serial}`); log(`No se pudo enlazar la tablet ${serial}; se reintenta:`, (error as Error).message); }
          continue;
        }
        linked.add(serial); warned.delete(serial); warned.delete(`reverse:${serial}`);
        log(`Tablet enlazada por USB (${serial}): en la tablet, abre http://localhost:${port}`);
        if (openPath) {
          // Abre la pizarra en Brave si está instalado (Shields bloquea anuncios en los enlaces);
          // si no, en el navegador predeterminado. «am start» informa el error por texto, no por código de salida.
          const view = ['-s', serial, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `http://localhost:${port}${openPath}`];
          try {
            const inBrave = await adb(adbPath, [...view, '-p', 'com.brave.browser']);
            if (/Error|unable to resolve/i.test(inBrave)) await adb(adbPath, view);
          } catch (error) { log('No se pudo abrir el navegador de la tablet:', (error as Error).message); }
        }
      }
      warned.delete('*');
    } catch (error) {
      if (!warned.has('*')) { warned.add('*'); log('No se pudo consultar la tablet (adb):', (error as Error).message); }
    }
  };
  const timer = setInterval(() => { void check(); }, intervalMs);
  timer.unref();
  void check();
  log(`Vigilando tablets por USB (adb: ${adbPath}).`);
  return { stop: () => clearInterval(timer), check, linked: () => [...linked] };
}
