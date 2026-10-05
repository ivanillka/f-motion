#Requires -Version 5.1
<#
.SYNOPSIS
  Light debloat: remove OEM/consumer apps, keep media/creative basics.
#>
param(
  [switch]$WhatIf
)

. "$PSScriptRoot\Common.ps1"

Write-BaselineStep 'Light debloat'

$root = Get-BaselineRoot
$listPath = Join-Path $root 'config\remove-apps.txt'
if (-not (Test-Path -LiteralPath $listPath)) {
  throw "Missing remove list: $listPath"
}

$names = Get-Content -LiteralPath $listPath |
  ForEach-Object { $_.Trim() } |
  Where-Object { $_ -and -not $_.StartsWith('#') }

$provisioned = Get-AppxProvisionedPackage -Online
$installed = Get-AppxPackage -AllUsers

foreach ($name in $names) {
  $provHits = $provisioned | Where-Object {
    $_.DisplayName -like "*$name*" -or $_.PackageName -like "*$name*"
  }
  $appHits = $installed | Where-Object {
    $_.Name -like "*$name*" -or $_.PackageFullName -like "*$name*"
  }

  if (-not $provHits -and -not $appHits) {
    continue
  }

  foreach ($p in $provHits) {
    if ($WhatIf) {
      Write-BaselineWarn "WhatIf: remove provisioned $($p.DisplayName)"
    } else {
      Remove-AppxProvisionedPackage -Online -PackageName $p.PackageName -ErrorAction SilentlyContinue | Out-Null
      Write-BaselineOk "Removed provisioned $($p.DisplayName)"
    }
  }

  foreach ($a in $appHits) {
    if ($WhatIf) {
      Write-BaselineWarn "WhatIf: remove app $($a.Name)"
    } else {
      Remove-AppxPackage -Package $a.PackageFullName -AllUsers -ErrorAction SilentlyContinue
      Write-BaselineOk "Removed $($a.Name)"
    }
  }
}

# Trim noisy startup suggestions / consumer content (HKCU + HKLM policies)
if (-not $WhatIf) {
  Set-RegistryDword -Path 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\ContentDeliveryManager' -Name 'SystemPaneSuggestionsEnabled' -Value 0
  Set-RegistryDword -Path 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\ContentDeliveryManager' -Name 'SubscribedContent-338388Enabled' -Value 0
  Set-RegistryDword -Path 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\ContentDeliveryManager' -Name 'SubscribedContent-338389Enabled' -Value 0
  Set-RegistryDword -Path 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\ContentDeliveryManager' -Name 'SubscribedContent-310093Enabled' -Value 0
  Set-RegistryDword -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\CloudContent' -Name 'DisableWindowsConsumerFeatures' -Value 1
  Set-RegistryDword -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\CloudContent' -Name 'DisableSoftLanding' -Value 1
  Write-BaselineOk 'Disabled Start suggestions / consumer features'
}

# Keep Windows Search / Widgets quieter without removing Shell experiences creatives may need
if (-not $WhatIf) {
  Set-RegistryDword -Path 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Advanced' -Name 'TaskbarDa' -Value 0
  Set-RegistryDword -Path 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Advanced' -Name 'ShowTaskViewButton' -Value 0
  Set-RegistryDword -Path 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Search' -Name 'SearchboxTaskbarMode' -Value 1
  Write-BaselineOk 'Taskbar: Widgets off, Task View off, search icon only'
}

Write-BaselineOk 'Debloat pass finished (Photos/Camera/Store/Paint kept)'
