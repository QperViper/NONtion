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
