// Sincroniza ahora con Supabase desde la consola («Sincronizar con Supabase.cmd» o `npm run sync`).
// Si nontion está abierto, se le pide a su API (un solo proceso escribe local_db.json); si no, lo hace aquí.
import './env.ts';
import type { SyncResult, SyncStatus } from './sync.ts';

const port = Number(process.env.PORT || 4000);
const describe = (result: SyncResult) => result.ok
  ? `Listo: ${result.pushed} subidos, ${result.pulled} descargados, ${result.removed} borrados, ${result.assets} imágenes.`
    + (result.conflicts.length ? `\nConflictos resueltos sin perder nada:\n${result.conflicts.map(c => `  · ${c.table}: ${c.resolution === 'copia' ? `copia «${c.title}»` : c.resolution === 'fusion' ? 'ajustes fusionados' : 'se mantuvo la versión de la nube'}`).join('\n')}` : '')
  : result.state === 'disabled' ? 'Falta SUPABASE_URL y SUPABASE_SECRET_KEY en backend/.env.' : `No se pudo sincronizar: ${result.error}`;

let result: SyncResult;
const running = await fetch(`http://127.0.0.1:${port}/api/sync`, { method: 'POST', signal: AbortSignal.timeout(120_000) })
  .then(async response => (await response.json() as SyncStatus & { result: SyncResult }).result, () => null);
if (running) {
  console.log('nontion está abierto: sincronizando a través de su API…');
  result = running;
} else {
  const { localDb } = await import('./localDb.ts');
  const { SyncService, remoteFromEnv } = await import('./sync.ts');
  const { uploadPending } = await import('./storage.ts');
  const service = new SyncService(localDb, remoteFromEnv(), { uploadAsset: uploadPending, intervalMs: 0 });
  result = await service.sync();
  await localDb.persist();
}
console.log(describe(result));
if (!result.ok) process.exitCode = 1;
