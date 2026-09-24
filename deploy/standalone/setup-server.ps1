$ErrorActionPreference = "Stop"

$WebRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$EnvFile = Join-Path $WebRoot ".env.standalone"
$Example = Join-Path $WebRoot ".env.standalone.example"

if (Test-Path $EnvFile) {
    Write-Host "$EnvFile already exists. No secrets were changed."
    exit 0
}

function New-RandomSecret([int]$Bytes = 36) {
    $buffer = New-Object byte[] $Bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
    return [Convert]::ToBase64String($buffer).Replace("+","A").Replace("/","B").Replace("=","")
}

$sqlPassword = "Slh!" + (New-RandomSecret 24)
$jwtKey = New-RandomSecret 48
$adminPassword = "Tms!" + (New-RandomSecret 18)

$content = Get-Content $Example -Raw
$content = $content.Replace("CHANGE_ME_STRONG_SQL_PASSWORD", $sqlPassword)
$content = $content.Replace("CHANGE_ME_RANDOM_MINIMUM_32_CHARACTERS", $jwtKey)
$content = $content.Replace("CHANGE_ME_STRONG_ADMIN_PASSWORD", $adminPassword)
$content = $content.Replace("SQL_BACKUP_HOST_PATH=./backup", "SQL_BACKUP_HOST_PATH=../../backup")
$content = $content.Replace("ARCHIVE_HOST_PATH=./archive", "ARCHIVE_HOST_PATH=../../archive")

Set-Content -Path $EnvFile -Value $content -Encoding utf8NoBOM

Write-Host ""
Write-Host "Created $EnvFile with generated local runtime secrets."
Write-Host ""
Write-Host "Initial TMS admin username: admin"
Write-Host "Initial TMS admin password: $adminPassword"
Write-Host ""
Write-Host "Record that password securely. Change it from the TMS Users screen after first sign-in."
Write-Host "External provider credentials remain blank/disabled until configured directly on the server."
