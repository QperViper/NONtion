# Crea los accesos directos de nontion en este equipo (Escritorio, menú Inicio e inicio automático de Windows).
# Uso: doble clic en "Instalar NONtion.cmd" (en la raíz del proyecto). Para quitarlos: "Instalar NONtion.cmd" -Desinstalar
param([switch]$Desinstalar, [switch]$SinInicioAutomatico, [switch]$SinTablet)
$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$programs = [Environment]::GetFolderPath('Programs')
$startupDir = [Environment]::GetFolderPath('Startup')
$links = @(
  @{ Path = Join-Path $desktop 'NONtion.lnk'; Args = 'scripts\launch.mjs'; Desc = 'Abrir nontion' },
  @{ Path = Join-Path $programs 'NONtion.lnk'; Args = 'scripts\launch.mjs'; Desc = 'Abrir nontion' },
  @{ Path = Join-Path $programs 'Detener NONtion.lnk'; Args = 'scripts\stop.mjs'; Desc = 'Detener el servidor de nontion' }
)
if (-not $SinInicioAutomatico) {
  $links += @{ Path = Join-Path $startupDir 'NONtion.lnk'; Args = 'scripts\launch.mjs --startup'; Desc = 'Iniciar nontion al encender' }
}

if ($Desinstalar) {
  foreach ($link in $links + @{ Path = Join-Path $startupDir 'NONtion.lnk' }) {
    if (Test-Path $link.Path) { Remove-Item $link.Path; Write-Host "Quitado: $($link.Path)" }
  }
  return
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'No se encontró Node.js. Instálalo desde https://nodejs.org y vuelve a ejecutar este instalador.' }
if (-not (Test-Path (Join-Path $root 'node_modules')) -or -not (Test-Path (Join-Path $root 'backend\node_modules'))) {
  Write-Host 'Instalando dependencias (solo la primera vez)…'
  Push-Location $root
  try { pnpm install; pnpm --dir backend install } finally { Pop-Location }
}
if (-not (Test-Path (Join-Path $root 'backend\.env'))) {
  Write-Warning 'Falta backend\.env con DATABASE_URL. Créalo antes de abrir nontion.'
}

# Tablet Android por USB: adb (Android platform-tools, descarga oficial de Google) en %LOCALAPPDATA%\nontion.
if (-not $SinTablet) {
  $tools = Join-Path $env:LOCALAPPDATA 'nontion'
  $adb = Join-Path $tools 'platform-tools\adb.exe'
  if ((Test-Path $adb) -or (Get-Command adb -ErrorAction SilentlyContinue)) {
    Write-Host 'adb (tablet por USB) ya está instalado.'
  } else {
    Write-Host 'Descargando Android platform-tools de Google para usar la tablet por USB…'
    $zip = Join-Path $env:TEMP 'nontion-platform-tools.zip'
    try {
      [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
      $ProgressPreference = 'SilentlyContinue'
      Invoke-WebRequest 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip' -OutFile $zip -UseBasicParsing
      New-Item -ItemType Directory -Force $tools | Out-Null
      Expand-Archive $zip -DestinationPath $tools -Force
      Remove-Item $zip -ErrorAction SilentlyContinue
      Write-Host "adb instalado en $adb"
    } catch {
      Write-Warning "No se pudo descargar adb: $($_.Exception.Message). Vuelve a ejecutar este instalador con internet para usar la tablet."
    }
  }
}

$icon = Join-Path $root 'scripts\nontion.ico'
foreach ($link in $links) {
  $shortcut = $shell.CreateShortcut($link.Path)
  $shortcut.TargetPath = $node
  $shortcut.Arguments = "`"$(Join-Path $root $link.Args.Split(' ')[0])`" $($link.Args.Split(' ', 2)[1])".Trim()
  $shortcut.WorkingDirectory = $root
  $shortcut.WindowStyle = 7   # minimizada: la consola del lanzador no estorba
  $shortcut.Description = $link.Desc
  if (Test-Path $icon) { $shortcut.IconLocation = "$icon,0" }
  $shortcut.Save()
  Write-Host "Creado: $($link.Path)"
}
# Reinicia nontion para que use lo recién instalado (por ejemplo, adb).
& $node (Join-Path $root 'scripts\stop.mjs') | Out-Null
Start-Process -FilePath $node -ArgumentList "`"$(Join-Path $root 'scripts\launch.mjs')`"" -WorkingDirectory $root -WindowStyle Minimized

Write-Host ''
Write-Host 'Listo. nontion se abrirá solo al iniciar sesión en Windows; también puedes abrirlo desde el Escritorio o el menú Inicio.'
