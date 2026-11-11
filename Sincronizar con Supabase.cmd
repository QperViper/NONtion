@echo off
rem Sincroniza ahora tu espacio con Supabase (subir lo pendiente y traer lo nuevo de otros equipos).
rem Si nontion esta abierto, se lo pide a su API; si no, lo hace directamente sobre backend\data\local_db.json.
rem Requiere SUPABASE_URL y SUPABASE_SECRET_KEY en backend\.env. No necesita PostgreSQL.
cd /d "%~dp0"
node --import ./backend/node_modules/tsx/dist/loader.mjs backend/sync-cli.ts %*
echo.
pause
