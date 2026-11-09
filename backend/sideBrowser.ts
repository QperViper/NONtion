import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HttpError } from './validation.ts';

/**
 * Ventana lateral del panel «Internet»: Brave (o Chrome/Edge) en modo aplicación, con un perfil propio
 * de nontion y control por CDP solo en 127.0.0.1. Se reutiliza una única ventana: buscar otra cosa la
 * navega y la vuelve a colocar al costado. Si está cerrada no consume memoria.
 */
export const SIDE_PORT = () => Number(process.env.NONTION_SIDE_PORT || 9227);

export function findBrowser(): string | null {
  const preferred = process.env.NONTION_BROWSER;
  if (preferred && existsSync(preferred)) return preferred;
  if (process.platform !== 'win32') return null;
  const bases = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean) as string[];
  for (const parts of [['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'], ['Google', 'Chrome', 'Application', 'chrome.exe'], ['Microsoft', 'Edge', 'Application', 'msedge.exe']]) {
    for (const base of bases) { const exe = path.join(base, ...parts); if (existsSync(exe)) return exe; }
  }
  return null;
}

/** Perfil separado: así la ventana lateral se puede controlar sin tocar tu navegador habitual. */
export const profileDir = () => process.env.NONTION_SIDE_PROFILE
  || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'nontion', 'navegador');

/** Solo páginas web: nada de file:, javascript:, chrome:// ni direcciones locales del equipo. */
export function safeUrl(raw: unknown): string {
  let url: URL;
  try { url = new URL(String(raw)); } catch { throw new HttpError(400, 'Dirección inválida.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new HttpError(400, 'Solo se abren páginas web (http o https).');
  if (!process.env.NONTION_SIDE_ALLOW_LOCAL && /^(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(url.hostname)) throw new HttpError(400, 'No se abren direcciones locales en la ventana lateral.');
  return url.toString();
}

export interface Bounds { left: number; top: number; width: number; height: number; }
export function validBounds(raw: unknown): Bounds | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const b = raw as Record<string, unknown>;
  const n = (v: unknown, min: number, max: number) => Number.isInteger(v) && Number(v) >= min && Number(v) <= max ? Number(v) : null;
  const left = n(b.left, -20000, 20000), top = n(b.top, -20000, 20000), width = n(b.width, 320, 10000), height = n(b.height, 240, 10000);
  return left === null || top === null || width === null || height === null ? undefined : { left, top, width, height };
}

/** Conexión CDP mínima (WebSocket nativo de Node 22). */
async function connect(wsUrl: string) {
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', () => reject(new Error('No se pudo conectar con la ventana lateral.')), { once: true });
  });
  let next = 0;
  const pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  ws.addEventListener('message', event => {
    const msg = JSON.parse(String(event.data)) as { id?: number; result?: Record<string, unknown>; error?: { message: string } };
    const waiter = msg.id === undefined ? undefined : pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id!);
    if (msg.error) waiter.reject(new Error(msg.error.message)); else waiter.resolve(msg.result ?? {});
  });
  const send = <T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, sessionId?: string) => new Promise<T>((resolve, reject) => {
    const id = ++next;
    pending.set(id, { resolve: resolve as (v: Record<string, unknown>) => void, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`CDP sin respuesta: ${method}`)); }, 5000);
  });
  return { send, close: () => ws.close() };
}

async function browserEndpoint(): Promise<string | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${SIDE_PORT()}/json/version`, { signal: AbortSignal.timeout(800) });
    return ((await res.json()) as { webSocketDebuggerUrl?: string }).webSocketDebuggerUrl ?? null;
  } catch { return null; }
}

async function place(send: Awaited<ReturnType<typeof connect>>['send'], targetId: string, bounds?: Bounds) {
  if (!bounds) return;
  const { windowId } = await send<{ windowId: number }>('Browser.getWindowForTarget', { targetId });
  // Desde maximizada/minimizada hay que volver a «normal» antes de mover.
  await send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
  await send('Browser.setWindowBounds', { windowId, bounds });
}

export async function openSide(rawUrl: unknown, rawBounds?: unknown): Promise<{ mode: 'reused' | 'opened' }> {
  const url = safeUrl(rawUrl), bounds = validBounds(rawBounds);
  const endpoint = await browserEndpoint();
  if (endpoint) {
    const cdp = await connect(endpoint);
    try {
      const { targetInfos } = await cdp.send<{ targetInfos: { targetId: string; type: string }[] }>('Target.getTargets');
      let page = targetInfos.find(t => t.type === 'page');
      if (page) {
        const { sessionId } = await cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId: page.targetId, flatten: true });
        await cdp.send('Page.navigate', { url }, sessionId);
      } else {
        page = { targetId: (await cdp.send<{ targetId: string }>('Target.createTarget', { url, newWindow: true })).targetId, type: 'page' };
      }
      await place(cdp.send, page.targetId, bounds);
      await cdp.send('Target.activateTarget', { targetId: page.targetId });
      return { mode: 'reused' };
    } finally { cdp.close(); }
  }
  const browser = findBrowser();
  if (!browser) throw new HttpError(501, 'No se encontró Brave, Chrome ni Edge en este equipo.');
  mkdirSync(profileDir(), { recursive: true });
  const args = [`--user-data-dir=${profileDir()}`, `--remote-debugging-port=${SIDE_PORT()}`, '--no-first-run', '--no-default-browser-check', `--app=${url}`];
  if (bounds) args.push(`--window-position=${bounds.left},${bounds.top}`, `--window-size=${bounds.width},${bounds.height}`);
  if (process.env.NONTION_SIDE_EXTRA_ARGS) args.push(...process.env.NONTION_SIDE_EXTRA_ARGS.split(' ').filter(Boolean));
  spawn(browser, args, { detached: true, stdio: 'ignore', windowsHide: false }).unref();
  return { mode: 'opened' };
}

export async function closeSide() {
  const endpoint = await browserEndpoint();
  if (!endpoint) return false;
  const cdp = await connect(endpoint);
  try { await cdp.send('Browser.close'); } catch { /* ya se cerró */ } finally { cdp.close(); }
  return true;
}
