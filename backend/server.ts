import { app, sync } from './app.ts';
import { localDb, localDbFile } from './localDb.ts';
import { serveUi } from './ui.ts';
import { latestBackupTables, scheduleBackups } from './backup.ts';
import { cloudConfig, ensureBucket } from './storage.ts';
import { watchTablets } from './tablet.ts';
import { stopCapture } from './capture.ts';
import { scheduleTrashCleanup } from './maintenance.ts';

// --ui: modo de uso diario. La API también entrega la app compilada en el mismo puerto.
if (process.argv.includes('--ui') && !serveUi(app)) console.warn('No existe dist/. Ejecuta "npm run build" para servir la interfaz.');

const port = Number(process.env.PORT || 4000);

// Primera vez en este equipo (no existe local_db.json): se parte del último respaldo diario, si hay, para
// abrir con tus datos aunque no haya internet. Luego la sincronización trae solo lo que cambió en la nube.
if (localDb.isNew) {
  const backup = await latestBackupTables();
  if (backup) { localDb.seed(backup.tables, backup.source); await localDb.persist(); console.log(`local_db.json creado a partir de ${backup.source}.`); }
  else if (sync.enabled) {
    // Sin respaldo: se espera un poco la primera descarga para no abrir un espacio vacío.
    console.log('local_db.json nuevo: descargando tu espacio desde Supabase…');
    const first = await Promise.race([sync.sync(), new Promise<null>(resolve => setTimeout(resolve, 15_000, null))]);
    if (!first?.ok) console.warn('No se pudo descargar todavía (sin internet): la app abre vacía y se completará al volver la conexión.');
  }
}

const server = app.listen(port, '127.0.0.1', () => {
  console.log(`nontion API: http://127.0.0.1:${port} · datos en ${localDbFile} · interfaz lista en ${Math.round(performance.now())} ms`);
  console.log(sync.enabled ? 'Sincronización con Supabase activada.' : 'Sin SUPABASE_URL/SUPABASE_SECRET_KEY en backend/.env: nontion funciona solo en este equipo.');
});
server.on('error', error => {
  console.error('No se pudo abrir el puerto', port, (error as {code?: string}).code);
  process.exit(1);
});

// Sincronización: una al arrancar (si hay red), tras cada escritura (con espera) y periódica.
sync.start();
if (cloudConfig()) ensureBucket().then(() => console.log('Imágenes: Supabase Storage listo.'), error => console.warn('Supabase Storage no disponible por ahora:', (error as Error).message));
const stopBackups = scheduleBackups(localDb);
const stopTrash = scheduleTrashCleanup();

// Tablet Android por USB (si adb está instalado). NONTION_TABLET_ABRIR=0 evita abrir la pizarra al conectarla.
const tablets = watchTablets({ port, openPath: process.env.NONTION_TABLET_ABRIR === '0' ? null : '/pizarra' });
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    sync.stop(); stopBackups(); stopTrash(); tablets?.stop(); void stopCapture();
    server.close(); server.closeIdleConnections();
    // Lo último escrito se termina de guardar antes de salir.
    void localDb.persist().finally(() => process.exit(0));
  });
}
