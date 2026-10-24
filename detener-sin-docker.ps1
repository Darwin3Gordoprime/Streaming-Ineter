$ErrorActionPreference = 'Stop'
$processFile = Join-Path $PSScriptRoot 'data\local-processes.json'
if (-not (Test-Path -LiteralPath $processFile)) { Write-Host 'No hay una sesión local registrada.'; exit 0 }
$ids = Get-Content -LiteralPath $processFile -Raw | ConvertFrom-Json
foreach ($entry in @(@{ Id = [int]$ids.nodePid; Match = 'server.js'; Name = 'node' }, @{ Id = [int]$ids.mediaMtxPid; Match = 'mediamtx.local.yml'; Name = 'mediamtx' })) {
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($entry.Id)" -ErrorAction SilentlyContinue
    if ($processInfo -and $processInfo.Name -like "$($entry.Name)*" -and $processInfo.CommandLine.Contains($entry.Match)) {
        Stop-Process -Id $entry.Id -Force
    }
}
Remove-Item -LiteralPath $processFile -Force
Write-Host 'En Vivo se detuvo. Las grabaciones y la configuración siguen guardadas.'
