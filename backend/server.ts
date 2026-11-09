import { app, database } from './app.ts';
import { migrate } from './migrate.ts';
import { pool } from './db.ts';
import { serveUi } from './ui.ts';
import { scheduleBackups } from './backup.ts';
import { cloudConfig, ensureBucket } from './storage.ts';
import { watchTablets } from './tablet.ts';
import { stopCapture } from './capture.ts';
import { scheduleTrashCleanup } from './maintenance.ts';

// --ui: modo de uso diario. La API también entrega la app compilada en el mismo puerto.
if (process.argv.includes('--ui') && !serveUi(app)) console.warn('No existe dist/. Ejecuta "npm run build" para servir la interfaz.');

// La app se sirve aunque Supabase no responda (sin internet, en la universidad): así se abre con la copia
// local del navegador. Mientras tanto se reintenta la conexión cada 15 s y, al volver, todo se sincroniza.
const bootStart = performance.now();
const port = Number(process.env.PORT || 4000);
database.ready = false;
let retry: NodeJS.Timeout | undefined;
let stopJobs = () => {};
let warned = false;

const server = app.listen(port, '127.0.0.1', () => {
  console.log(`nontion API: http://127.0.0.1:${port} · interfaz lista en ${Math.round(performance.now())} ms`);
  void connect();
});
server.on('error', error => {
  console.error('No se pudo abrir el puerto', port, (error as {code?: string}).code);
  process.exit(1);
});

async function connect() {
  try {
    await migrate();
    database.ready = true;
    console.log(`Base de datos lista (${Math.round(performance.now() - bootStart)} ms desde el arranque).`);
    if (warned) console.log('Volvió la conexión con la base de datos.');
    if (cloudConfig()) ensureBucket().then(() => console.log('Imágenes: Supabase Storage listo.'), error => console.error('Supabase Storage no disponible:', (error as Error).message));
    const stopBackups = scheduleBackups();
    const stopTrash = scheduleTrashCleanup();
    stopJobs = () => { stopBackups(); stopTrash(); };
  } catch (error) {
    // Un solo aviso por corte: el registro no se llena mientras dura.
    if (!warned) console.error('Sin conexión con la base de datos; se reintenta cada 15 s. Revisa internet o la DATABASE_URL.', (error as {code?: string}).code ?? (error as Error).message);
    warned = true;
    retry = setTimeout(() => { void connect(); }, 15_000);
  }
}

// Tablet Android por USB (si adb está instalado). NONTION_TABLET_ABRIR=0 evita abrir la pizarra al conectarla.
const tablets = watchTablets({ port, openPath: process.env.NONTION_TABLET_ABRIR === '0' ? null : '/pizarra' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    clearTimeout(retry); stopJobs(); tablets?.stop(); void stopCapture();
    server.close(() => { void pool.end(); }); server.closeIdleConnections();
  });
}
