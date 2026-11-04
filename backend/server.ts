import { app } from './app.ts';
import { migrate } from './migrate.ts';
import { pool } from './db.ts';

try {
  await migrate();
  const server = app.listen(Number(process.env.PORT || 4000), '127.0.0.1', () => {
    console.log(`nontion API: http://127.0.0.1:${process.env.PORT || 4000}`);
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => server.close(() => { void pool.end(); }));
  }
} catch (error) {
  console.error('No se pudo iniciar PostgreSQL. Revisa DATABASE_URL.', (error as {code?: string}).code);
  await pool.end(); process.exitCode = 1;
}
