$ErrorActionPreference = "Stop"

$WebRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Parent = Split-Path -Parent $WebRoot
$ApiRoot = Join-Path $Parent "API"
if (-not (Test-Path $ApiRoot)) { $ApiRoot = Join-Path $Parent "slh-tms-v2-api" }
$EnvFile = Join-Path $WebRoot ".env.standalone"
$ComposeFile = Join-Path $WebRoot "deploy\standalone\docker-compose.yml"

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { throw "$Name is required on the SLH server." }
}
function Read-EnvValue([string]$Name) {
    $line = Get-Content $EnvFile | Where-Object { $_ -match ("^" + [regex]::Escape($Name) + "=") } | Select-Object -First 1
    if (-not $line) { return "" }
    return ($line -split '=',2)[1].Trim()
}

Require-Command "git"
Require-Command "docker"
if (-not (Test-Path $ApiRoot)) { throw "Expected sibling API repository at $ApiRoot" }

Write-Host "Updating canonical V2 repositories from main..."
git -C $WebRoot fetch origin main
git -C $WebRoot checkout main
git -C $WebRoot pull --ff-only origin main
git -C $ApiRoot fetch origin main
git -C $ApiRoot checkout main
git -C $ApiRoot pull --ff-only origin main

if (-not (Test-Path $EnvFile)) {
    Copy-Item (Join-Path $WebRoot ".env.standalone.example") $EnvFile
    Write-Host "Created $EnvFile. Populate the runtime values, then run this script again."
    exit 2
}

$required = @("SQL_SA_PASSWORD","ENTRA_TENANT_ID","ENTRA_WEB_CLIENT_ID","ENTRA_API_AUDIENCE","ENTRA_API_SCOPE")
foreach ($name in $required) {
    $value = Read-EnvValue $name
    if ([string]::IsNullOrWhiteSpace($value) -or $value -like "CHANGE_ME*") { throw "$name must be populated in .env.standalone before V2 can start." }
}

$profiles = Read-EnvValue "COMPOSE_PROFILES"
if ($profiles -match "(^|,)remote(,|$)") {
    if ([string]::IsNullOrWhiteSpace((Read-EnvValue "CLOUDFLARE_TUNNEL_TOKEN"))) { throw "Remote profile requires CLOUDFLARE_TUNNEL_TOKEN." }
    if ([string]::IsNullOrWhiteSpace((Read-EnvValue "TMS_PUBLIC_URL"))) { throw "Remote profile requires TMS_PUBLIC_URL." }
}

New-Item -ItemType Directory -Force -Path (Join-Path $WebRoot "backup") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $WebRoot "archive") | Out-Null

Write-Host "Validating Docker Compose configuration..."
docker compose --env-file $EnvFile -f $ComposeFile config | Out-Null
Write-Host "Building and starting SLH TMS V2..."
docker compose --env-file $EnvFile -f $ComposeFile up -d --build

$port = Read-EnvValue "TMS_HTTP_PORT"
if ([string]::IsNullOrWhiteSpace($port)) { $port = "8080" }
$health = "http://127.0.0.1:$port/tms-api/api/v1/health"
Write-Host "Waiting for API health..."
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
Write-Host ("Local portal: http://" + $env:COMPUTERNAME + ":" + $port)
$publicUrl = Read-EnvValue "TMS_PUBLIC_URL"
if (-not [string]::IsNullOrWhiteSpace($publicUrl)) { Write-Host "Remote portal: $publicUrl" }
Write-Host "Authentication: Microsoft Entra"
Write-Host "API health: $health"
docker compose --env-file $EnvFile -f $ComposeFile ps
