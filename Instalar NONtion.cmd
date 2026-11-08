@echo off
rem Crea los accesos directos de nontion (Escritorio, menu Inicio e inicio automatico).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\instalar-accesos.ps1" %*
echo.
pause
