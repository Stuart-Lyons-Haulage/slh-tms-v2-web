$ErrorActionPreference = "Stop"

$WebRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Parent = Split-Path -Parent $WebRoot
$ApiRoot = Join-Path $Parent "API"
if (-not (Test-Path $ApiRoot)) {
    $ApiRoot = Join-Path $Parent "slh-tms-v2-api"
}
$EnvFile = Join-Path $WebRoot ".env.standalone"
$ComposeFile = Join-Path $WebRoot "deploy\standalone\docker-compose.yml"

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name is required on the SLH server."
    }
}

Require-Command "git"
Require-Command "docker"

if (-not (Test-Path $ApiRoot)) {
    throw "Expected sibling API repository at $ApiRoot"
}

Write-Host "Updating canonical V2 repositories from main..."
git -C $WebRoot fetch origin main
git -C $WebRoot checkout main
git -C $WebRoot pull --ff-only origin main

git -C $ApiRoot fetch origin main
git -C $ApiRoot checkout main
git -C $ApiRoot pull --ff-only origin main

if (-not (Test-Path $EnvFile)) {
    Copy-Item (Join-Path $WebRoot ".env.standalone.example") $EnvFile
    Write-Host ""
    Write-Host "Created $EnvFile"
    Write-Host "Populate the runtime secrets in that file, then run this script again."
    exit 2
}

New-Item -ItemType Directory -Force -Path (Join-Path $WebRoot "backup") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $WebRoot "archive") | Out-Null

Write-Host "Validating Docker Compose configuration..."
docker compose --env-file $EnvFile -f $ComposeFile config | Out-Null

Write-Host "Building and starting SLH TMS V2..."
docker compose --env-file $EnvFile -f $ComposeFile up -d --build

$portLine = Get-Content $EnvFile | Where-Object { $_ -match '^TMS_HTTP_PORT=' } | Select-Object -First 1
$port = if ($portLine) { ($portLine -split '=',2)[1].Trim() } else { "8080" }

Write-Host "Waiting for API health..."
$health = "http://127.0.0.1:$port/tms-api/api/v1/health"
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        $response = Invoke-RestMethod -Uri $health -TimeoutSec 5
        if ($response.status -eq "healthy") { $ready = $true; break }
    } catch {}
    Start-Sleep -Seconds 2
}

if (-not $ready) {
    docker compose --env-file $EnvFile -f $ComposeFile ps
    throw "V2 containers started, but API health did not become ready at $health."
}

Write-Host ""
Write-Host "SLH TMS V2 is healthy."
Write-Host "Portal: http://${env:COMPUTERNAME}:$port"
Write-Host "API health: $health"
docker compose --env-file $EnvFile -f $ComposeFile ps
