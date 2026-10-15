[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$InstallerPath,
    [string]$ExpectedVersion,
    [string]$ExpectedSha256
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

$authenticode = Get-AuthenticodeSignature -LiteralPath $resolvedInstaller
[pscustomobject]@{
    Version = $ExpectedVersion
    Installer = $resolvedInstaller
    InstallerBytes = $installer.Length
    Sha256 = $hash.Hash
    UpdaterSignature = $signaturePath
    UpdaterSignatureBytes = $signatureFile.Length
    WindowsCodeSignature = [string]$authenticode.Status
}
