#Requires -Version 5.1
<#
.SYNOPSIS
  Optional creative tooling via winget + media-friendly Explorer defaults.
#>
param(
  [switch]$WhatIf,
  [switch]$InstallPackages
)

. "$PSScriptRoot\Common.ps1"

Write-BaselineStep 'Creative-ready defaults'

if (-not $WhatIf) {
  # Show file extensions + hidden files (critical for media pipelines)
  Set-RegistryDword -Path 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Advanced' -Name 'HideFileExt' -Value 0
  Set-RegistryDword -Path 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Advanced' -Name 'Hidden' -Value 1
  Write-BaselineOk 'Explorer: extensions + hidden files visible'

  # Long paths help deep project trees (DaVinci / AE / photo catalogs)
  Set-RegistryDword -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name 'LongPathsEnabled' -Value 1
  Write-BaselineOk 'Win32 long paths enabled'
}

if (-not $InstallPackages) {
  Write-BaselineWarn 'Skipped winget packages (pass -InstallCreativeTools on the orchestrator to install)'
  return
}

$root = Get-BaselineRoot
$pkg = Join-Path $root 'config\packages.winget.json'
if (-not (Test-Path -LiteralPath $pkg)) {
  throw "Missing package list: $pkg"
}

$winget = Get-Command winget -ErrorAction SilentlyContinue
if (-not $winget) {
  Write-BaselineWarn 'winget not found — install App Installer from the Microsoft Store, then re-run with -InstallCreativeTools'
  return
}

if ($WhatIf) {
  Write-BaselineWarn "WhatIf: would winget import $pkg"
  return
}

Write-BaselineStep 'Installing creative baseline packages (winget)'
& winget import -i $pkg --accept-package-agreements --accept-source-agreements --disable-interactivity
if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978334964) {
  # -1978334964 = no applicable upgrade / already installed variants sometimes
  Write-BaselineWarn "winget import exited with code $LASTEXITCODE (some packages may already be present)"
} else {
  Write-BaselineOk 'winget import finished'
}

Write-BaselineWarn 'Adobe / DaVinci / Capture One: install from vendor accounts (not in winget list by design).'
