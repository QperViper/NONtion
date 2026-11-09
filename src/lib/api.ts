export class ApiError extends Error {
  status: number;
  current?: Record<string, unknown>;
  constructor(status: number, message: string, current?: Record<string, unknown>) { super(message); this.status=status;this.current=current; }
}
const base = import.meta.env.VITE_API_URL || '/api';
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(15000), headers: { ...(init.body && !(init.body instanceof Blob) ? {'Content-Type':'application/json'} : {}), ...init.headers } });
  } catch {
    throw new ApiError(0,'El servidor local no está disponible o no respondió a tiempo. Reintenta cuando vuelva a estar conectado.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.error || 'No se pudo completar la petición.', data.current);
  return data as T;
}
export function assetUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('/assets/') && base.startsWith('http')) return `${new URL(base).origin}${url}`;
  return url;
}

/**
 * Cuerpo JSON para PATCH/POST. Si es grande (una pizarra con muchos trazos) y el navegador lo permite,
 * se envía comprimido con gzip: suele pesar 5–10 veces menos. El servidor lo descomprime solo.
 */
export const COMPRESS_FROM = 16 * 1024;
export async function jsonBody(value: unknown): Promise<RequestInit> {
  const text = JSON.stringify(value);
  if (text.length < COMPRESS_FROM || typeof CompressionStream === 'undefined') return { body: text };
  const gzipped = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  return { body: gzipped, headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' } };
}
