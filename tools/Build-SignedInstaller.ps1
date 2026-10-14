[CmdletBinding()]
param(
    [string]$TargetDirectory
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$appRoot = Join-Path $repositoryRoot 'tauri-prototype\app'
$tauriConfig = Get-Content -LiteralPath (Join-Path $appRoot 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
$version = [string]$tauriConfig.version
if (-not $TargetDirectory) {
    $TargetDirectory = Join-Path $env:TEMP "flow-files-$version-candidate"
}

$privateKeyPath = Join-Path $env:USERPROFILE '.tauri\flow-files.key'
$passwordBackupPath = Join-Path $env:USERPROFILE '.tauri\flow-files-signing-password.dpapi'
if (-not (Test-Path -LiteralPath $privateKeyPath)) {
    throw "Updater private key not found: $privateKeyPath"
}
if (-not (Test-Path -LiteralPath $passwordBackupPath)) {
    throw "Encrypted updater password backup not found: $passwordBackupPath"
}

& (Join-Path $PSScriptRoot 'Check-Version.ps1') -ExpectedVersion $version
New-Item -ItemType Directory -Force -Path $TargetDirectory | Out-Null

$encryptedPassword = (Get-Content -LiteralPath $passwordBackupPath -Raw).Trim()
$securePassword = ConvertTo-SecureString $encryptedPassword
$plainPassword = [System.Net.NetworkCredential]::new('', $securePassword).Password
$previousPrivateKey = $env:TAURI_SIGNING_PRIVATE_KEY
$previousPassword = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
$previousTarget = $env:CARGO_TARGET_DIR

try {
    $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -LiteralPath $privateKeyPath -Raw
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $plainPassword
    $env:CARGO_TARGET_DIR = $TargetDirectory
    Push-Location $appRoot
    try {
        & npm run build:installer
        if ($LASTEXITCODE -ne 0) {
            throw "Signed installer build failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}
finally {
    $env:TAURI_SIGNING_PRIVATE_KEY = $previousPrivateKey
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $previousPassword
    $env:CARGO_TARGET_DIR = $previousTarget
    $plainPassword = $null
}

$bundleDirectory = Join-Path $TargetDirectory 'release\bundle\nsis'
$installer = Get-ChildItem -LiteralPath $bundleDirectory -Filter '*-setup.exe' -File | Select-Object -First 1
if (-not $installer) {
    throw "NSIS installer was not produced in $bundleDirectory"
}
$signature = Get-Item -LiteralPath "$($installer.FullName).sig" -ErrorAction Stop
$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $installer.FullName

[pscustomobject]@{
    Version = $version
    Installer = $installer.FullName
    Signature = $signature.FullName
    InstallerBytes = $installer.Length
    Sha256 = $hash.Hash
}
