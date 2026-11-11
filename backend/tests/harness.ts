// Arranca la API sobre una carpeta de datos temporal (nunca toca backend/data/ ni Supabase).
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function startApi({ cloud = false }: { cloud?: boolean } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nontion-api-'));
  process.env.NONTION_DATA_DIR = dir;
  // Vacías (no borradas): dotenv no pisa variables ya definidas, así backend/.env no activa la nube real.
  if (!cloud) { process.env.SUPABASE_URL = ''; process.env.SUPABASE_SECRET_KEY = ''; }
  const { app } = await import('../app.ts');
  const { localDb } = await import('../localDb.ts');
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.on('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = async (route: string, method = 'GET', body?: unknown) => {
    const res = await fetch(`${origin}/api${route}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json() };
  };
  const close = async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await localDb.persist();
    await rm(dir, { recursive: true, force: true });
  };
  return { origin, call, close, dir, localDb };
}
