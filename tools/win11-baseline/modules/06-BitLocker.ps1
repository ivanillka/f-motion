#Requires -Version 5.1
<#
.SYNOPSIS
  Enable BitLocker / device encryption when TPM allows; always write recovery key.
#>
param(
  [switch]$WhatIf
)

. "$PSScriptRoot\Common.ps1"

Write-BaselineStep 'Disk encryption'

$keyDir = Join-Path $env:USERPROFILE 'Desktop'
$keyPath = Join-Path $keyDir 'BitLocker-Recovery-KEY.txt'

if ($WhatIf) {
  Write-BaselineWarn "WhatIf: would enable BitLocker on $env:SystemDrive and write recovery key to $keyPath"
  return
}

function Save-RecoveryKey {
  param($Volume)
  $protectors = @($Volume.KeyProtector | Where-Object { $_.KeyProtectorType -eq 'RecoveryPassword' })
  if (-not $protectors.Count) {
    Write-BaselineWarn 'No RecoveryPassword protector found yet'
    return
  }
  $lines = @(
    "Computer: $env:COMPUTERNAME"
    "Drive: $($Volume.MountPoint)"
    "Saved: $(Get-Date -Format o)"
    ''
    'STORE THIS OFFLINE. Anyone with this file can unlock the drive.'
    ''
  )
  foreach ($p in $protectors) {
    $lines += "KeyProtectorId: $($p.KeyProtectorId)"
    $lines += "RecoveryPassword: $($p.RecoveryPassword)"
    $lines += ''
  }
  if (-not (Test-Path -LiteralPath $keyDir)) {
    New-Item -ItemType Directory -Path $keyDir -Force | Out-Null
  }
  Set-Content -LiteralPath $keyPath -Value ($lines -join "`r`n") -Encoding UTF8
  Write-BaselineOk "Recovery key written to $keyPath — copy to a USB/password manager, then delete the Desktop copy"
}

$mount = $env:SystemDrive
$vol = Get-BitLockerVolume -MountPoint $mount -ErrorAction SilentlyContinue
if (-not $vol) {
  Write-BaselineWarn 'BitLocker cmdlets unavailable (edition/policy). Use Settings > Privacy & security > Device encryption if offered.'
  return
}

if ($vol.ProtectionStatus -eq 'On' -and $vol.VolumeStatus -ne 'FullyDecrypted') {
  Write-BaselineOk "BitLocker already protecting $mount"
  Save-RecoveryKey -Volume $vol
  return
}

$tpm = Get-Tpm -ErrorAction SilentlyContinue
if (-not $tpm -or -not $tpm.TpmPresent -or -not $tpm.TpmReady) {
  Write-BaselineWarn 'TPM not ready — skipping BitLocker enable. Fix firmware TPM, then re-run.'
  return
}

try {
  # UsedSpaceOnly keeps first boot fast on large media drives that are still system volumes.
  Enable-BitLocker -MountPoint $mount -EncryptionMethod XtsAes256 -UsedSpaceOnly -TpmProtector -ErrorAction Stop | Out-Null
  # Ensure a recoverable password protector exists for offline unlock
  $vol = Get-BitLockerVolume -MountPoint $mount
  $hasRecovery = $vol.KeyProtector | Where-Object { $_.KeyProtectorType -eq 'RecoveryPassword' }
  if (-not $hasRecovery) {
    Add-BitLockerKeyProtector -MountPoint $mount -RecoveryPasswordProtector | Out-Null
    $vol = Get-BitLockerVolume -MountPoint $mount
  }
  Save-RecoveryKey -Volume $vol
  Write-BaselineOk "BitLocker enabled on $mount (encryption continues in background)"
} catch {
  Write-BaselineWarn "BitLocker enable failed: $($_.Exception.Message). Try Settings > Device encryption, or Pro/Enterprise policy."
}
