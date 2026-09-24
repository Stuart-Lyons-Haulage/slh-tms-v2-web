$ErrorActionPreference = "Stop"

$WebRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$EnvFile = Join-Path $WebRoot ".env.standalone"
$Example = Join-Path $WebRoot ".env.standalone.example"

if (Test-Path $EnvFile) {
    Write-Host "$EnvFile already exists. No runtime values were changed."
    exit 0
}

function New-RandomSecret([int]$Bytes = 36) {
    $buffer = New-Object byte[] $Bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
    return [Convert]::ToBase64String($buffer).Replace("+","A").Replace("/","B").Replace("=","")
}

$sqlPassword = "Slh!" + (New-RandomSecret 24)

$content = Get-Content $Example -Raw
$content = $content.Replace("CHANGE_ME_STRONG_SQL_PASSWORD", $sqlPassword)
Set-Content -Path $EnvFile -Value $content -Encoding utf8NoBOM

Write-Host ""
Write-Host "Created $EnvFile with a generated SQL password."
Write-Host "There is no separate TMS username/password to create."
Write-Host "Populate the ENTRA_* values from the Lyons Microsoft Entra app registrations."
Write-Host "For remote access, add the Cloudflare tunnel token and public URL only after the hostname exists."
Write-Host "External provider credentials remain blank/disabled until configured directly on the server."
