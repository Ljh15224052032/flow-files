[CmdletBinding()]
param(
    [string]$ExpectedVersion,
    [switch]$RequireInstalled
)

$ErrorActionPreference = 'Stop'
$uninstallRoots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$entries = @(Get-ItemProperty -Path $uninstallRoots -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'Flow Files' })
if ($entries.Count -gt 1) {
    throw "Multiple Flow Files uninstall entries were found: $($entries.Count)."
}

$entry = $entries | Select-Object -First 1
$desktopShortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Flow Files.lnk'
$startMenuRoot = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$startMenuShortcuts = @(Get-ChildItem -LiteralPath $startMenuRoot -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.BaseName -eq 'Flow Files' })
$shell = New-Object -ComObject WScript.Shell

function Get-ShortcutTarget {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    return $shell.CreateShortcut($Path).TargetPath
}

$desktopTarget = Get-ShortcutTarget -Path $desktopShortcutPath
$startMenuTargets = @($startMenuShortcuts | ForEach-Object { Get-ShortcutTarget -Path $_.FullName })
$installLocation = if ($entry) { [string]$entry.InstallLocation } else { '' }
$installedExecutable = if ($installLocation) { Join-Path $installLocation 'flow-files.exe' } else { $null }
$installedExecutableExists = !!($installedExecutable -and (Test-Path -LiteralPath $installedExecutable -PathType Leaf))
$statePath = Join-Path $env:LOCALAPPDATA 'com.coderebuild.filemanagerlab'

if ($RequireInstalled -and -not $entry) {
    throw 'Flow Files is not registered as an installed application for this Windows user.'
}
if ($entry -and $ExpectedVersion -and [string]$entry.DisplayVersion -ne $ExpectedVersion) {
    throw "Installed Flow Files version '$($entry.DisplayVersion)' does not match '$ExpectedVersion'."
}
if ($RequireInstalled -and -not $installedExecutableExists) {
    throw "The registered install location does not contain flow-files.exe: $installedExecutable"
}
if ($RequireInstalled -and -not ($startMenuTargets | Where-Object { $_ -eq $installedExecutable })) {
    throw 'The Start menu shortcut is missing or does not target the installed Flow Files executable.'
}

[pscustomobject]@{
    Installed = [bool]$entry
    DisplayVersion = if ($entry) { [string]$entry.DisplayVersion } else { $null }
    InstallLocation = if ($entry) { $installLocation } else { $null }
    InstalledExecutable = $installedExecutable
    InstalledExecutableExists = $installedExecutableExists
    UninstallCommand = if ($entry) { [string]$entry.UninstallString } else { $null }
    DesktopShortcut = $desktopShortcutPath
    DesktopShortcutTarget = $desktopTarget
    StartMenuShortcuts = @($startMenuShortcuts | ForEach-Object { $_.FullName })
    StartMenuTargets = $startMenuTargets
    StatePath = $statePath
    StatePathExists = Test-Path -LiteralPath $statePath -PathType Container
}
