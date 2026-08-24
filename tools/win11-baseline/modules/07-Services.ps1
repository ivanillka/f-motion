#Requires -Version 5.1
<#
.SYNOPSIS
  Disable noisy / unused services; keep search + SysMain for creative machines.
#>
param(
  [switch]$WhatIf
)

. "$PSScriptRoot\Common.ps1"

Write-BaselineStep 'Service trim (light)'

# Name = target Start type (Disabled | Manual)
$targets = [ordered]@{
  'RemoteRegistry'     = 'Disabled'
  'RetailDemo'         = 'Disabled'
  'dmwappushservice'   = 'Disabled'
  'XblAuthManager'     = 'Disabled'
  'XblGameSave'        = 'Disabled'
  'XboxNetApiSvc'      = 'Disabled'
  'XboxGipSvc'         = 'Disabled'
  'DiagTrack'          = 'Manual'
  'WerSvc'             = 'Manual'
  'MapsBroker'         = 'Disabled'
  'Fax'                = 'Disabled'
  'PhoneSvc'           = 'Manual'
  'TabletInputService' = 'Manual'
}

foreach ($name in $targets.Keys) {
  $svc = Get-Service -Name $name -ErrorAction SilentlyContinue
  if (-not $svc) { continue }
  $start = $targets[$name]
  if ($WhatIf) {
    Write-BaselineWarn "WhatIf: set $name -> $start"
    continue
  }
  try {
    Set-Service -Name $name -StartupType $start -ErrorAction Stop
    if ($start -eq 'Disabled' -and $svc.Status -eq 'Running') {
      Stop-Service -Name $name -Force -ErrorAction SilentlyContinue
    }
    Write-BaselineOk "$name -> $start"
  } catch {
    Write-BaselineWarn "Could not set $name : $($_.Exception.Message)"
  }
}

Write-BaselineOk 'SysMain + WSearch left running (library / file find)'
