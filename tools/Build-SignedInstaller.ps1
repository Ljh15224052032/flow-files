[CmdletBinding()]
param(
    [string]$TargetDirectory,
    [switch]$AllowDirty
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$appRoot = Join-Path $repositoryRoot 'tauri-prototype\app'
$tauriConfig = Get-Content -LiteralPath (Join-Path $appRoot 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
$version = [string]$tauriConfig.version
$sourceCommit = (& git -C $repositoryRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceCommit -notmatch '^[0-9a-f]{40}$') {
    throw 'Unable to resolve the source commit for this candidate.'
}
$sourceStatus = @(& git -C $repositoryRoot status --porcelain --untracked-files=all)
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to inspect the Git worktree before building the candidate.'
}
$sourceDirty = $sourceStatus.Count -gt 0
if ($sourceDirty -and -not $AllowDirty) {
    throw 'Refusing to build a release candidate from a dirty worktree. Commit or stash the changes, or pass -AllowDirty for a non-release diagnostic build.'
}
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
$signatureHash = Get-FileHash -Algorithm SHA256 -LiteralPath $signature.FullName
$authenticode = Get-AuthenticodeSignature -LiteralPath $installer.FullName
$manifestPath = "$($installer.FullName).candidate.json"
$manifest = [ordered]@{
    schemaVersion = 1
    productName = [string]$tauriConfig.productName
    version = $version
    identifier = [string]$tauriConfig.identifier
    sourceCommit = $sourceCommit
    sourceDirty = $sourceDirty
    builtAtUtc = [DateTime]::UtcNow.ToString('o')
    installer = [ordered]@{
        fileName = $installer.Name
        bytes = $installer.Length
        sha256 = $hash.Hash
        windowsCodeSignature = [string]$authenticode.Status
    }
    updaterSignature = [ordered]@{
        fileName = $signature.Name
        bytes = $signature.Length
        sha256 = $signatureHash.Hash
    }
    installMode = [string]$tauriConfig.bundle.windows.nsis.installMode
    updaterInstallMode = [string]$tauriConfig.plugins.updater.windows.installMode
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding utf8

[pscustomobject]@{
    Version = $version
    SourceCommit = $sourceCommit
    SourceDirty = $sourceDirty
    Installer = $installer.FullName
    Signature = $signature.FullName
    CandidateManifest = $manifestPath
    InstallerBytes = $installer.Length
    Sha256 = $hash.Hash
}
