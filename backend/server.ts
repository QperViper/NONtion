import { app } from './app.ts';
import { migrate } from './migrate.ts';
import { pool } from './db.ts';
import { serveUi } from './ui.ts';
import { scheduleBackups } from './backup.ts';

// --ui: modo de uso diario. La API también entrega la app compilada en el mismo puerto.
if (process.argv.includes('--ui') && !serveUi(app)) console.warn('No existe dist/. Ejecuta "npm run build" para servir la interfaz.');

try {
  await migrate();
  const port = Number(process.env.PORT || 4000);
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`nontion API: http://127.0.0.1:${port}`);
  });
  server.on('error', error => {
    console.error('No se pudo abrir el puerto', port, (error as {code?: string}).code);
    void pool.end(); process.exitCode = 1;
  });
  const stopBackups = scheduleBackups();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => { stopBackups(); server.close(() => { void pool.end(); }); });
  }
} catch (error) {
  console.error('No se pudo iniciar PostgreSQL. Revisa DATABASE_URL.', (error as {code?: string}).code);
  await pool.end(); process.exitCode = 1;
}
