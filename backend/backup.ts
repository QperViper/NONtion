import { existsSync } from 'node:fs';
import { copyFile, link, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TABLES, publicRow } from './fileStorage.ts';
import type { FileStorageService, TableName } from './fileStorage.ts';
import { assetsDir, cloudConfig, syncCacheFromCloud } from './storage.ts';

export const backupRoot = fileURLToPath(new URL('./backups/daily/', import.meta.url));
const KEEP = 14;
const HOUR = 60 * 60 * 1000;
const MAX_AGE = 20 * HOUR;

/** Respaldos completos ya terminados, del más nuevo al más antiguo. */
export async function listBackups(): Promise<string[]> {
  if (!existsSync(backupRoot)) return [];
  const names = await readdir(backupRoot);
  return names.filter(name => /^\d{4}-\d{2}-\d{2}T[\d-]+Z$/.test(name)).sort().reverse();
}

/** Las imágenes no cambian nunca (nombre UUID, escritura exclusiva): un enlace duro evita duplicar espacio. */
async function snapshotAssets(target: string) {
  if (!existsSync(assetsDir)) return 0;
  await mkdir(target, { recursive: true });
  let count = 0;
  for (const name of await readdir(assetsDir)) {
    if (name.startsWith('.')) continue; // descargas a medio escribir
    const from = path.join(assetsDir, name);
    if (!(await stat(from)).isFile()) continue;
    try { await link(from, path.join(target, name)); } catch { await copyFile(from, path.join(target, name)); }
    count++;
  }
  return count;
}

/**
 * Copia completa: local_db.json tal cual (restaurable copiándolo a backend/data/), database.json con las
 * filas de cada tabla (mismo formato que los respaldos de la época de PostgreSQL) e imágenes.
 */
export async function backupNow(db: FileStorageService): Promise<string> {
  const name = new Date().toISOString().replace(/[:.]/g, '-');
  const partial = path.join(backupRoot, `${name}.partial`);
  await mkdir(partial, { recursive: true });
  try {
    const snapshot = db.snapshot();
    await writeFile(path.join(partial, 'local_db.json'), JSON.stringify(snapshot));
    const tables = Object.fromEntries(TABLES.map(table => [table, Object.values(snapshot[table]).filter(row => !row._purge).map(row => publicRow(row))]));
    await writeFile(path.join(partial, 'database.json'), JSON.stringify({ createdAt: new Date().toISOString(), tables }));
    // Con Supabase, la carpeta local de imágenes se completa primero con las subidas desde otro equipo.
    let cloudNote = '';
    if (cloudConfig()) {
      try { cloudNote = ` (descargadas de la nube para completar: ${await syncCacheFromCloud()})`; }
      catch (error) { cloudNote = ` (no se pudo completar desde la nube: ${(error as Error).message})`; }
    }
    const assets = await snapshotAssets(path.join(partial, 'assets'));
    await writeFile(path.join(partial, 'LEEME.txt'), [
      `Respaldo de nontion · ${new Date().toLocaleString('es')}`,
      `Tablas: ${Object.entries(tables).map(([t, rows]) => `${t} (${rows.length})`).join(', ')}`,
      `Imágenes: ${assets}${cloudNote}`,
      '',
      'Para restaurar: con nontion cerrado, copia local_db.json a backend/data/local_db.json',
      'y la carpeta assets/ dentro de backend/data/assets/. Al abrir, se sincroniza con Supabase.',
    ].join('\r\n'));
    const final = path.join(backupRoot, name);
    await rename(partial, final);
    await prune();
    return final;
  } catch (error) {
    await rm(partial, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Filas del respaldo más reciente (para sembrar un local_db.json nuevo sin internet). Sirve también con
 * los respaldos de la época de PostgreSQL. Devuelve null si no hay ninguno legible.
 */
export async function latestBackupTables(): Promise<{ source: string; tables: Partial<Record<TableName, Record<string, unknown>[]>> } | null> {
  for (const name of await listBackups()) {
    try {
      const parsed = JSON.parse(await readFile(path.join(backupRoot, name, 'database.json'), 'utf8')) as { tables?: Record<string, Record<string, unknown>[]> };
      if (!parsed.tables) continue;
      const tables: Partial<Record<TableName, Record<string, unknown>[]>> = {};
      for (const table of TABLES) if (Array.isArray(parsed.tables[table])) tables[table] = parsed.tables[table];
      return { source: `backups/daily/${name}`, tables };
    } catch { /* respaldo incompleto o de otro formato: se prueba el anterior */ }
  }
  return null;
}

async function prune() {
  const backups = await listBackups();
  for (const old of backups.slice(KEEP)) await rm(path.join(backupRoot, old), { recursive: true, force: true });
  if (!existsSync(backupRoot)) return;
  for (const name of await readdir(backupRoot)) {
    if (name.endsWith('.partial')) await rm(path.join(backupRoot, name), { recursive: true, force: true }).catch(() => {});
  }
}

function ageOf(name: string) {
  const iso = name.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z');
  return Date.now() - Date.parse(iso);
}

/** Respaldo diario mientras la API está en marcha: al arrancar si el último tiene más de 20 h, y luego cada hora se revisa. */
export function scheduleBackups(db: FileStorageService): () => void {
  let running = false;
  const check = async () => {
    if (running) return;
    running = true;
    try {
      const [latest] = await listBackups();
      if (!latest || ageOf(latest) > MAX_AGE) console.log('Respaldo creado:', await backupNow(db));
    } catch (error) {
      console.error('No se pudo crear el respaldo diario:', (error as Error).message);
    } finally { running = false; }
  };
  const first = setTimeout(() => { void check(); }, 30_000);
  const hourly = setInterval(() => { void check(); }, HOUR);
  first.unref(); hourly.unref();
  return () => { clearTimeout(first); clearInterval(hourly); };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Desde la consola (npm run backup). Si la API está abierta, conviene usar su respaldo automático:
  // aquí se lee el archivo tal como está en el disco.
  const { localDb } = await import('./localDb.ts');
  backupNow(localDb).then(dir => console.log('Respaldo creado:', dir)).catch(error => {
    console.error('No se pudo respaldar:', error.message); process.exitCode = 1;
  });
}
