@echo off
rem Copia tu espacio local a Supabase (base de datos + imagenes) y vuelve a abrir nontion.
rem Antes: completa DATABASE_URL, LOCAL_DATABASE_URL, SUPABASE_URL y SUPABASE_SECRET_KEY en backend\.env
rem Opciones: --solo-imagenes (reintenta solo las imagenes)  --reemplazar (pisa lo que ya haya en Supabase)
cd /d "%~dp0"
echo Deteniendo nontion...
node scripts\stop.mjs
echo.
node --import ./backend/node_modules/tsx/dist/loader.mjs backend/transfer.ts %*
if errorlevel 1 (
  echo.
  echo El traspaso no se completo. Revisa el mensaje de arriba; tu base local no se modifico.
  pause
  exit /b 1
)
echo.
echo Abriendo nontion conectado a Supabase...
start "" /min node scripts\launch.mjs
pause
