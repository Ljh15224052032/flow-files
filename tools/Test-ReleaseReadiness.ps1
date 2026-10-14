[CmdletBinding()]
param(
    [switch]$SkipRust
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$appRoot = Join-Path $repositoryRoot 'tauri-prototype\app'

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][scriptblock]$Command
    )

    Write-Host "`n==> $Name" -ForegroundColor Cyan
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE."
    }
}

& (Join-Path $PSScriptRoot 'Check-Version.ps1')

Push-Location $appRoot
try {
    Invoke-CheckedCommand 'Frontend tests' { npm test }
    Invoke-CheckedCommand 'Production frontend build' { npm run build }
    if (-not $SkipRust) {
        Invoke-CheckedCommand 'Rust backend tests' { cargo test --manifest-path src-tauri/Cargo.toml }
    }
}
finally {
    Pop-Location
}

Push-Location $repositoryRoot
try {
    Invoke-CheckedCommand 'Whitespace and patch validation' { git diff --check }
}
finally {
    Pop-Location
}

Write-Host "`nFlow Files release preflight passed." -ForegroundColor Green
Write-Host 'Continue with docs/RELEASE_ACCEPTANCE.md before publishing a draft release.'
