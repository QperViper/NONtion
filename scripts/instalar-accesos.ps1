# Crea los accesos directos de nontion en este equipo (Escritorio, menú Inicio e inicio automático de Windows).
# Uso: doble clic en "Instalar NONtion.cmd" (en la raíz del proyecto). Para quitarlos: "Instalar NONtion.cmd" -Desinstalar
param([switch]$Desinstalar, [switch]$SinInicioAutomatico)
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
Write-Host ''
Write-Host 'Listo. nontion se abrirá solo al iniciar sesión en Windows; también puedes abrirlo desde el Escritorio o el menú Inicio.'
