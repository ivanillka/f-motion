#Requires -Version 5.1
<#
.SYNOPSIS
  Media workspace folders + Explorer / codec-friendly defaults.
#>
param(
  [switch]$WhatIf,
  [switch]$SkipPackages
)

. "$PSScriptRoot\Common.ps1"

Write-BaselineStep 'Creative-ready defaults'

$mediaRoot = Join-Path $env:USERPROFILE 'Media'
$subdirs = @('Inbox', 'Projects', 'Exports', 'Stills', 'Video', 'Audio', 'Scratch')

if ($WhatIf) {
  Write-BaselineWarn "WhatIf: would create $mediaRoot\{$($subdirs -join ',')}, Explorer/long-path tweaks, winget import"
} else {
  New-Item -ItemType Directory -Path $mediaRoot -Force | Out-Null
  foreach ($d in $subdirs) {
    New-Item -ItemType Directory -Path (Join-Path $mediaRoot $d) -Force | Out-Null
  }
  Write-BaselineOk "Media workspace: $mediaRoot"

  Set-RegistryDword -Path 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Advanced' -Name 'HideFileExt' -Value 0
  Set-RegistryDword -Path 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Advanced' -Name 'Hidden' -Value 1
  Write-BaselineOk 'Explorer: extensions + hidden files visible'

  Set-RegistryDword -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name 'LongPathsEnabled' -Value 1
  Write-BaselineOk 'Win32 long paths enabled'

  # Quiet Copilot taskbar button when policy key is honored
  Set-RegistryDword -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced' -Name 'ShowCopilotButton' -Value 0
  Set-RegistryDword -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsCopilot' -Name 'TurnOffWindowsCopilot' -Value 1
  Write-BaselineOk 'Copilot taskbar button / policy off'
}

if ($SkipPackages) {
  Write-BaselineWarn 'Skipped winget packages (-SkipPackages)'
  return
}

$root = Get-BaselineRoot
$pkg = Join-Path $root 'config\packages.winget.json'
if (-not (Test-Path -LiteralPath $pkg)) {
  throw "Missing package list: $pkg"
}

$winget = Get-Command winget -ErrorAction SilentlyContinue
if (-not $winget) {
  Write-BaselineWarn 'winget not found — install App Installer from Microsoft Store, then re-run'
  return
}

if ($WhatIf) {
  Write-BaselineWarn "WhatIf: would winget source update + import $pkg"
  return
}

Write-BaselineStep 'winget source update'
& winget source update --disable-interactivity | Out-Null

Write-BaselineStep 'Installing full creative utility stack (winget)'
& winget import -i $pkg --accept-package-agreements --accept-source-agreements --disable-interactivity
if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978334964) {
  Write-BaselineWarn "winget import exited with code $LASTEXITCODE (some packages may already be present or unavailable)"
} else {
  Write-BaselineOk 'winget import finished'
}

Write-BaselineWarn 'Still manual after reboot: GPU drivers (NVIDIA/AMD/Intel) + Adobe / DaVinci / Capture One from your accounts.'
