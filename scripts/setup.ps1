param(
    [string]$ComposeFile = "$PSScriptRoot\\..\\AlgoPlatform.API\\docker-compose.yml",
    [switch]$Up
)

$enable = Join-Path $PSScriptRoot "enable-runsc.ps1"
if (-not (Test-Path $enable)) {
    throw "enable-runsc.ps1 not found at $enable"
}

& $enable

if ($Up) {
    docker compose -f $ComposeFile up -d --build
}

Write-Output "Setup complete. runsc enabled." 
