import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from './db.ts';

export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(78163412)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const migrations = (await readdir(new URL('./migrations/', import.meta.url))).filter(name => /^\d+_[a-z_]+\.sql$/.test(name)).sort();
    for (const filename of migrations) {
      const id = filename.slice(0, -4);
      const applied = await client.query('SELECT id FROM schema_migrations WHERE id=$1', [id]);
      if (applied.rowCount) continue;
      // A consistent pre-migration copy of the four existing tables, kept outside Git.
      const backup: Record<string, unknown> = {};
      for (const table of ['workspace_settings', 'documents', 'whiteboards', 'hyperthreads']) {
        const exists = await client.query('SELECT to_regclass($1) AS name', [`public.${table}`]);
        if (exists.rows[0].name) backup[table] = (await client.query(`SELECT * FROM ${table}`)).rows;
      }
      const directory = new URL('./backups/', import.meta.url);
      await mkdir(directory, { recursive: true });
      await writeFile(new URL(`before-${id}-${Date.now()}.json`, directory), JSON.stringify(backup), { flag: 'wx' });
      await client.query(await readFile(new URL(`./migrations/${filename}`, import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations(id) VALUES($1)', [id]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate().then(() => console.log('Migraciones aplicadas.')).catch((error) => {
    console.error('No se pudo migrar:', error.code ?? error.message); process.exitCode = 1;
  }).finally(() => pool.end());
}
