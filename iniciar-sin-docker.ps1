$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$toolsDir = Join-Path $PSScriptRoot 'tools'
$localFfmpeg = Join-Path $toolsDir 'ffmpeg.exe'
$localMediaMtx = Join-Path $toolsDir 'mediamtx.exe'
$ffmpegCommand = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
$wingetPackageDir = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
$wingetFfmpeg = Get-ChildItem -LiteralPath $wingetPackageDir -Directory -Filter 'Gyan.FFmpeg.Shared*' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $ffmpegCommand -and $wingetFfmpeg) {
    $ffmpegCommand = (Get-ChildItem -LiteralPath $wingetFfmpeg.FullName -Filter 'ffmpeg.exe' -Recurse | Select-Object -First 1).FullName
}
if (-not $ffmpegCommand -and (Test-Path -LiteralPath $localFfmpeg)) { $ffmpegCommand = $localFfmpeg }
$mediaMtxCommand = if (Test-Path -LiteralPath $localMediaMtx) { $localMediaMtx } else { (Get-Command mediamtx -ErrorAction SilentlyContinue).Source }

if (-not $mediaMtxCommand) { throw 'No encuentro mediamtx.exe. Descárgalo o colócalo en tools\mediamtx.exe.' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js no está disponible en PATH.' }

if ($ffmpegCommand) { $env:FFMPEG_PATH = $ffmpegCommand }
$env:PATH = "$toolsDir;$env:PATH"
$env:MEDIAMTX_API_URL = 'http://127.0.0.1:9997'
$env:MEDIAMTX_RTSP_BASE = 'rtsp://127.0.0.1:8554'
$env:OBS_WS_HOST = '127.0.0.1'
$env:PORT = '3000'
$env:ADMIN_PORT = '3012'

$dataDir = Join-Path $PSScriptRoot 'data'
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
$processFile = Join-Path $dataDir 'local-processes.json'
if (Test-Path -LiteralPath $processFile) {
    $previous = Get-Content -LiteralPath $processFile -Raw | ConvertFrom-Json
    $running = @($previous.nodePid, $previous.mediaMtxPid) | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }
    if ($running.Count -gt 0) { throw 'El modo local ya parece estar ejecutándose. Usa detener-sin-docker.ps1 antes de iniciarlo otra vez.' }
}

$mediaProcess = $null
try {
    $mediaProcess = Start-Process -FilePath $mediaMtxCommand -ArgumentList @('mediamtx.local.yml') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru
    Start-Sleep -Seconds 2
    if ($mediaProcess.HasExited) { throw 'MediaMTX se cerró al iniciar. Revisa mediamtx.local.yml y que el puerto 1935 esté libre.' }
    $nodePath = (Get-Command node).Source
    $nodeProcess = Start-Process -FilePath $nodePath -ArgumentList @('server.js') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru
    Start-Sleep -Seconds 1
    if ($nodeProcess.HasExited) { throw 'El backend Node se cerró al iniciar. Revisa si el puerto 3000 ya está ocupado.' }
    @{ mediaMtxPid = $mediaProcess.Id; nodePid = $nodeProcess.Id } | ConvertTo-Json | Set-Content -LiteralPath $processFile
    Write-Host 'En Vivo está disponible en http://localhost:3000'
    Write-Host 'Panel administrativo disponible en http://localhost:3012'
    Write-Host 'OBS WebSocket: 127.0.0.1:4455 · RTMP local: 127.0.0.1:1935'
    if ($ffmpegCommand) { Write-Host 'FFmpeg detectado: se habilitan salidas RTMP adicionales.' }
    else { Write-Host 'Grabación local habilitada por MediaMTX. Salidas RTMP adicionales requieren FFmpeg.' }
    Write-Host 'Cierra el servicio con .\detener-sin-docker.ps1'
    Start-Process 'http://localhost:3000'
    Start-Process 'http://localhost:3012'
} catch {
    if ($mediaProcess -and -not $mediaProcess.HasExited) { Stop-Process -Id $mediaProcess.Id -Force }
    throw
}
