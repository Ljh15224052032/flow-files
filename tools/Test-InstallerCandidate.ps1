[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$InstallerPath,
    [string]$ExpectedVersion,
    [string]$ExpectedSha256,
    [string]$CandidateManifestPath
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$appRoot = Join-Path $repositoryRoot 'tauri-prototype\app'
$resolvedInstaller = (Resolve-Path -LiteralPath $InstallerPath).Path
$installer = Get-Item -LiteralPath $resolvedInstaller
if ($installer.Extension -ne '.exe') {
    throw "Installer candidate must be an .exe file: $resolvedInstaller"
}

if (-not $ExpectedVersion) {
    $config = Get-Content -LiteralPath (Join-Path $appRoot 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
    $ExpectedVersion = [string]$config.version
}
& (Join-Path $PSScriptRoot 'Check-Version.ps1') -ExpectedVersion $ExpectedVersion
$config = Get-Content -LiteralPath (Join-Path $appRoot 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
if ($config.productName -ne 'Flow Files' -or $config.identifier -ne 'com.coderebuild.filemanagerlab') {
    throw "Stable product identity mismatch: product='$($config.productName)', identifier='$($config.identifier)'."
}
if ($config.bundle.windows.nsis.installMode -ne 'currentUser') {
    throw "NSIS install mode must remain currentUser, found '$($config.bundle.windows.nsis.installMode)'."
}
if ($config.plugins.updater.windows.installMode -ne 'passive') {
    throw "Updater install mode must remain passive, found '$($config.plugins.updater.windows.installMode)'."
}
if (-not $config.plugins.updater.pubkey -or -not (@($config.plugins.updater.endpoints) | Where-Object { $_ -match '^https://github\.com/.+/releases/latest/download/latest\.json$' })) {
    throw 'Updater signing key or HTTPS latest.json endpoint is missing.'
}

$versionInfo = $installer.VersionInfo
if ($versionInfo.ProductName -ne 'Flow Files' -or $versionInfo.ProductVersion -ne $ExpectedVersion -or $versionInfo.FileVersion -ne $ExpectedVersion) {
    throw "Installer metadata mismatch: product='$($versionInfo.ProductName)', productVersion='$($versionInfo.ProductVersion)', fileVersion='$($versionInfo.FileVersion)', expected='$ExpectedVersion'."
}

$signaturePath = "$resolvedInstaller.sig"
if (-not (Test-Path -LiteralPath $signaturePath -PathType Leaf)) {
    throw "Tauri updater signature is missing: $signaturePath"
}
$signatureFile = Get-Item -LiteralPath $signaturePath
if ($signatureFile.Length -le 0) {
    throw "Tauri updater signature is empty: $signaturePath"
}

try {
    $encodedSignature = (Get-Content -LiteralPath $signaturePath -Raw).Trim()
    $decodedSignature = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encodedSignature))
}
catch {
    throw "Tauri updater signature is not valid base64: $($_.Exception.Message)"
}

$trustedComment = ($decodedSignature -split "`r?`n" | Where-Object { $_ -like 'trusted comment:*' } | Select-Object -First 1)
if (-not $decodedSignature.StartsWith('untrusted comment: signature from tauri secret key') -or -not $trustedComment) {
    throw 'Tauri updater signature does not contain the expected minisign envelope.'
}
if (-not $trustedComment.Contains("file:$($installer.Name)") -or -not $trustedComment.Contains("version:$ExpectedVersion")) {
    throw "Tauri updater signature metadata does not match $($installer.Name) version $ExpectedVersion."
}

$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedInstaller
if ($ExpectedSha256 -and $hash.Hash -ne $ExpectedSha256.Trim().ToUpperInvariant()) {
    throw "Installer SHA-256 mismatch: actual=$($hash.Hash), expected=$($ExpectedSha256.Trim().ToUpperInvariant())."
}

if (-not $CandidateManifestPath) {
    $CandidateManifestPath = "$resolvedInstaller.candidate.json"
}
$resolvedManifest = (Resolve-Path -LiteralPath $CandidateManifestPath -ErrorAction Stop).Path
$manifest = Get-Content -LiteralPath $resolvedManifest -Raw | ConvertFrom-Json
$signatureHash = Get-FileHash -Algorithm SHA256 -LiteralPath $signaturePath
if ($manifest.schemaVersion -ne 1 -or $manifest.productName -ne 'Flow Files' -or $manifest.identifier -ne 'com.coderebuild.filemanagerlab') {
    throw 'Candidate manifest schema or product identity is invalid.'
}
if ($manifest.version -ne $ExpectedVersion -or $manifest.installer.fileName -ne $installer.Name -or [long]$manifest.installer.bytes -ne $installer.Length -or $manifest.installer.sha256 -ne $hash.Hash) {
    throw 'Candidate manifest does not match the installer name, version, size, or SHA-256.'
}
if ($manifest.updaterSignature.fileName -ne $signatureFile.Name -or [long]$manifest.updaterSignature.bytes -ne $signatureFile.Length -or $manifest.updaterSignature.sha256 -ne $signatureHash.Hash) {
    throw 'Candidate manifest does not match the updater signature file.'
}
if ($manifest.sourceCommit -notmatch '^[0-9a-f]{40}$' -or $manifest.sourceDirty -ne $false) {
    throw 'Release candidate must record a clean 40-character Git source commit.'
}
if ($manifest.installMode -ne 'currentUser' -or $manifest.updaterInstallMode -ne 'passive') {
    throw 'Candidate manifest contains unsafe or unexpected installer modes.'
}

$authenticode = Get-AuthenticodeSignature -LiteralPath $resolvedInstaller
[pscustomobject]@{
    Version = $ExpectedVersion
    SourceCommit = $manifest.sourceCommit
    Installer = $resolvedInstaller
    InstallerBytes = $installer.Length
    Sha256 = $hash.Hash
    UpdaterSignature = $signaturePath
    UpdaterSignatureBytes = $signatureFile.Length
    CandidateManifest = $resolvedManifest
    WindowsCodeSignature = [string]$authenticode.Status
}
