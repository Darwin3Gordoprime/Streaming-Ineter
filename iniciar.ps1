$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
docker compose up --build -d
if ($LASTEXITCODE -ne 0) {
    throw 'No se pudo iniciar. Abre Docker Desktop y vuelve a ejecutar iniciar.ps1.'
}
Write-Host 'En Vivo está listo en http://localhost:3000'
Write-Host 'Panel de administración: http://localhost:3012'
Start-Process 'http://localhost:3000'
Start-Process 'http://localhost:3012'
