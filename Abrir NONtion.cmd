@echo off
rem Abre nontion sin instalar accesos directos (arranca el servidor si hace falta).
cd /d "%~dp0"
start "" /min node scripts\launch.mjs %*
