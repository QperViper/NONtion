import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { PoolConfig } from 'pg';

dotenv.config({ path: fileURLToPath(new URL('./.env', import.meta.url)), quiet: true });

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '']);

/**
 * Configuración de conexión. Las bases locales van sin TLS; las remotas (Supabase) siempre cifradas.
 * Con DATABASE_SSL_CA (certificado descargado de Supabase) además se verifica la identidad del servidor.
 * DATABASE_SSL=off|require|verify fuerza un modo concreto.
 */
export function poolConfig(connectionString = process.env.DATABASE_URL): PoolConfig {
  if (!connectionString) return { connectionTimeoutMillis: 5000 };
  let url: URL;
  try { url = new URL(connectionString); } catch { return { connectionString, connectionTimeoutMillis: 5000 }; }
  // sslmode en la URL tendría prioridad sobre la configuración de abajo; se gestiona aquí.
  url.searchParams.delete('sslmode');
  const remote = !LOCAL_HOSTS.has(url.hostname);
  const mode = process.env.DATABASE_SSL || (remote ? 'require' : 'off');
  const caPath = process.env.DATABASE_SSL_CA;
  const ca = caPath ? readFileSync(fileURLToPath(new URL(caPath, new URL('./', import.meta.url))), 'utf8') : undefined;
  const ssl = mode === 'off' ? false : { rejectUnauthorized: mode === 'verify' || Boolean(ca), ...(ca ? { ca } : {}) };
  return {
    connectionString: url.toString(), ssl, application_name: 'nontion',
    max: remote ? 4 : 10, idleTimeoutMillis: 30_000, keepAlive: true,
    connectionTimeoutMillis: remote ? 10_000 : 5000,
  };
}

export const isRemoteDatabase = Boolean(poolConfig().ssl);
export const pool = new pg.Pool(poolConfig());
// Un corte de red no debe tumbar la API: el pool descarta la conexión y la siguiente consulta reconecta.
const dropped = (error: Error) => { console.error('Conexión con la base interrumpida:', (error as { code?: string }).code ?? error.message); };
pool.on('error', dropped); // conexiones en reposo
// Conexiones prestadas (transacciones): sin este oyente, un corte en medio de una consulta cerraba el proceso.
// La consulta en curso igualmente falla y su petición responde con error; el navegador reintenta.
pool.on('connect', client => { client.on('error', dropped); });
