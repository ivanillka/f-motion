#Requires -Version 5.1
<#
.SYNOPSIS
  Light performance defaults for photo / video workstations.
#>
param(
  [switch]$WhatIf
)

. "$PSScriptRoot\Common.ps1"

Write-BaselineStep 'Performance (creative-ready)'

if ($WhatIf) {
  Write-BaselineWarn 'WhatIf: would set High Performance power, HAGS, Storage Sense off, visual effects Balanced'
  return
}

# High Performance power plan (ultimate if present)
$ultimate = powercfg -l | Select-String 'Ultimate Performance'
if ($ultimate) {
  $guid = ($ultimate.ToString() -split '\s+')[3]
  powercfg /S $guid | Out-Null
  Write-BaselineOk 'Ultimate Performance power plan'
} else {
  powercfg -duplicatescheme e9a42b02-d5df-448d-aa00-03f14749eb61 2>$null | Out-Null
  $ultimate2 = powercfg -l | Select-String 'Ultimate Performance'
  if ($ultimate2) {
    $guid = ($ultimate2.ToString() -split '\s+')[3]
    powercfg /S $guid | Out-Null
    Write-BaselineOk 'Ultimate Performance power plan (activated)'
  } else {
    powercfg /S 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c | Out-Null
    Write-BaselineOk 'High Performance power plan'
  }
}

# Never sleep on AC while editing; hibernate off (keeps disk free + avoids stale GPU state)
powercfg /change standby-timeout-ac 0
powercfg /change monitor-timeout-ac 20
powercfg /hibernate off
Write-BaselineOk 'AC sleep off; hibernate off; display 20m'

# Hardware-accelerated GPU scheduling (needs reboot + recent GPU driver)
Set-RegistryDword -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers' -Name 'HwSchMode' -Value 2
Write-BaselineOk 'Hardware-accelerated GPU scheduling enabled (reboot to apply)'

# Storage Sense off — creatives often keep large caches/exports on the system drive
Set-RegistryDword -Path 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\StorageSense\Parameters\StoragePolicy' -Name '01' -Value 0
Write-BaselineOk 'Storage Sense disabled'

# Visual effects: Let Windows choose / Balanced via SystemPropertiesPerformance is UI-only;
# set common smooth-scroll + animations lightly without "best appearance"
Set-RegistryDword -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects' -Name 'VisualFXSetting' -Value 2
Write-BaselineOk 'Visual effects set to Balanced'

# Disable Game DVR / background recording (GPU+disk tax)
Set-RegistryDword -Path 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\GameDVR' -Name 'AppCaptureEnabled' -Value 0
Set-RegistryDword -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\GameDVR' -Name 'AllowGameDVR' -Value 0
Write-BaselineOk 'Game DVR / background capture off'

# SysMain (Superfetch) stays ON — helps photo library / project app warm starts on HDD/SSD alike
Write-BaselineOk 'SysMain left enabled (library warm-start)'
