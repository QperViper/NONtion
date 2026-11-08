import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, link, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.ts';

export const backupRoot = fileURLToPath(new URL('./backups/daily/', import.meta.url));
const assetsDir = fileURLToPath(new URL('./data/assets/', import.meta.url));
const KEEP = 14;
const HOUR = 60 * 60 * 1000;
const MAX_AGE = 20 * HOUR;

/** Respaldos completos ya terminados, del más nuevo al más antiguo. */
export async function listBackups(): Promise<string[]> {
  if (!existsSync(backupRoot)) return [];
  const names = await readdir(backupRoot);
  return names.filter(name => /^\d{4}-\d{2}-\d{2}T[\d-]+Z$/.test(name)).sort().reverse();
}

function findPgDump(): string | null {
  const exe = process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump';
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir && existsSync(path.join(dir, exe))) return path.join(dir, exe);
  }
  return null;
}

/** Usa la versión instalada más reciente: un pg_dump nuevo puede leer servidores más antiguos. */
async function findWindowsPgDump(): Promise<string | null> {
  for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
    const pg = base && path.join(base, 'PostgreSQL');
    if (!pg || !existsSync(pg)) continue;
    const versions = (await readdir(pg)).filter(v => /^\d+(\.\d+)?$/.test(v)).sort((a, b) => parseFloat(b) - parseFloat(a));
    for (const version of versions) {
      const exe = path.join(pg, version, 'bin', 'pg_dump.exe');
      if (existsSync(exe)) return exe;
    }
  }
  return null;
}

function run(file: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    execFile(file, args, { timeout: 5 * 60 * 1000, windowsHide: true }, (error, _stdout, stderr) => {
      if (error) reject(new Error(stderr.trim().split('\n').pop() || error.message)); else resolve();
    });
  });
}

/** Las imágenes no cambian nunca (nombre UUID, escritura exclusiva): un enlace duro evita duplicar espacio. */
async function snapshotAssets(target: string) {
  if (!existsSync(assetsDir)) return 0;
  await mkdir(target, { recursive: true });
  let count = 0;
  for (const name of await readdir(assetsDir)) {
    const from = path.join(assetsDir, name);
    if (!(await stat(from)).isFile()) continue;
    try { await link(from, path.join(target, name)); } catch { await copyFile(from, path.join(target, name)); }
    count++;
  }
  return count;
}

/**
 * Copia completa: database.json (todas las tablas, lectura coherente), imágenes y,
 * si PostgreSQL está instalado en el equipo, también database.dump (restaurable con pg_restore).
 */
export async function backupNow(): Promise<string> {
  const name = new Date().toISOString().replace(/[:.]/g, '-');
  const partial = path.join(backupRoot, `${name}.partial`);
  await mkdir(partial, { recursive: true });
  try {
    const client = await pool.connect();
    const tables: Record<string, unknown[]> = {};
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const list = await client.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
      for (const { tablename } of list.rows) tables[tablename] = (await client.query(`SELECT * FROM "${tablename.replaceAll('"', '""')}"`)).rows;
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
    await writeFile(path.join(partial, 'database.json'), JSON.stringify({ createdAt: new Date().toISOString(), tables }));
    const assets = await snapshotAssets(path.join(partial, 'assets'));
    let dump = 'no disponible (pg_dump no está instalado en este equipo)';
    const pgDump = findPgDump() ?? (process.platform === 'win32' ? await findWindowsPgDump() : null);
    if (pgDump && process.env.DATABASE_URL) {
      try {
        await run(pgDump, ['--format=custom', '--no-owner', '--no-privileges', `--file=${path.join(partial, 'database.dump')}`, `--dbname=${process.env.DATABASE_URL}`]);
        dump = 'database.dump';
      } catch (error) { dump = `falló: ${(error as Error).message}`; }
    }
    await writeFile(path.join(partial, 'LEEME.txt'), [
      `Respaldo de nontion · ${new Date().toLocaleString('es')}`,
      `Tablas: ${Object.entries(tables).map(([t, rows]) => `${t} (${rows.length})`).join(', ')}`,
      `Imágenes: ${assets}`,
      `Volcado pg_dump: ${dump}`,
      '',
      'database.json contiene todas las filas. Para restaurar database.dump:',
      '  pg_restore --clean --if-exists --no-owner --dbname=<DATABASE_URL> database.dump',
      'Copia la carpeta assets/ dentro de backend/data/assets/.',
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
export function scheduleBackups(): () => void {
  let running = false;
  const check = async () => {
    if (running) return;
    running = true;
    try {
      const [latest] = await listBackups();
      if (!latest || ageOf(latest) > MAX_AGE) console.log('Respaldo creado:', await backupNow());
    } catch (error) {
      console.error('No se pudo crear el respaldo diario:', (error as { code?: string }).code ?? (error as Error).message);
    } finally { running = false; }
  };
  const first = setTimeout(() => { void check(); }, 30_000);
  const hourly = setInterval(() => { void check(); }, HOUR);
  first.unref(); hourly.unref();
  return () => { clearTimeout(first); clearInterval(hourly); };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  backupNow().then(dir => console.log('Respaldo creado:', dir)).catch(error => {
    console.error('No se pudo respaldar:', error.code ?? error.message); process.exitCode = 1;
  }).finally(() => pool.end());
}
