[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$appRoot = Join-Path $repositoryRoot 'tauri-prototype\app'

$package = Get-Content -LiteralPath (Join-Path $appRoot 'package.json') -Raw | ConvertFrom-Json -AsHashtable
$packageLock = Get-Content -LiteralPath (Join-Path $appRoot 'package-lock.json') -Raw | ConvertFrom-Json -AsHashtable
$tauri = Get-Content -LiteralPath (Join-Path $appRoot 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json -AsHashtable
$cargoLines = Get-Content -LiteralPath (Join-Path $appRoot 'src-tauri\Cargo.toml')
$insidePackage = $false
$cargoVersion = $null
foreach ($line in $cargoLines) {
    if ($line -eq '[package]') {
        $insidePackage = $true
        continue
    }
    if ($insidePackage -and $line -match '^\[') {
        break
    }
    if ($insidePackage -and $line -match '^version\s*=\s*"([^"]+)"') {
        $cargoVersion = $Matches[1]
        break
    }
}

if (-not $cargoVersion) {
    throw 'Unable to read the package version from Cargo.toml.'
}

$versions = [ordered]@{
    'package.json'     = [string]$package['version']
    'package-lock.json' = [string]$packageLock['version']
    'Cargo.toml'       = $cargoVersion
    'tauri.conf.json'  = [string]$tauri['version']
}

$uniqueVersions = @($versions.Values | Sort-Object -Unique)
if ($uniqueVersions.Count -ne 1) {
    $details = ($versions.GetEnumerator() | ForEach-Object { "{0}={1}" -f $_.Key, $_.Value }) -join ', '
    throw "Flow Files version mismatch: $details"
}

Write-Output "Flow Files version $($uniqueVersions[0]) is consistent across all manifests."
