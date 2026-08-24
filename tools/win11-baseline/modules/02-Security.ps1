#Requires -Version 5.1
<#
.SYNOPSIS
  Harden a fresh Win11 box without breaking creative apps.
#>
param(
  [switch]$WhatIf
)

. "$PSScriptRoot\Common.ps1"

Write-BaselineStep 'Security baseline'

if ($WhatIf) {
  Write-BaselineWarn 'WhatIf: would enable Defender, firewall, SmartScreen, disable SMBv1, tighten privacy'
  return
}

# Defender real-time + cloud protection
Set-MpPreference -DisableRealtimeMonitoring $false -ErrorAction SilentlyContinue
Set-MpPreference -MAPSReporting Advanced -ErrorAction SilentlyContinue
Set-MpPreference -SubmitSamplesConsent SendSafeSamples -ErrorAction SilentlyContinue
Set-MpPreference -EnableNetworkProtection Enabled -ErrorAction SilentlyContinue
Write-BaselineOk 'Microsoft Defender preferences'

# Firewall: domain/private/public on
Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled True
Write-BaselineOk 'Windows Firewall enabled on all profiles'

# SmartScreen (Explorer value is a string on Win11)
$explorer = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer'
if (-not (Test-Path -LiteralPath $explorer)) { New-Item -Path $explorer -Force | Out-Null }
New-ItemProperty -LiteralPath $explorer -Name 'SmartScreenEnabled' -PropertyType String -Value 'Warn' -Force | Out-Null
Set-RegistryDword -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\System' -Name 'EnableSmartScreen' -Value 1
Set-RegistryDword -Path 'HKLM:\SOFTWARE\Policies\Microsoft\MicrosoftEdge\PhishingFilter' -Name 'EnabledV9' -Value 1
Write-BaselineOk 'SmartScreen enabled'

# UAC: prompt for consent on secure desktop (default Admin Approval Mode)
Set-RegistryDword -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name 'ConsentPromptBehaviorAdmin' -Value 2
Set-RegistryDword -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name 'EnableLUA' -Value 1
Write-BaselineOk 'UAC left on (secure desktop consent)'

# Disable SMBv1
Disable-WindowsOptionalFeature -Online -FeatureName SMB1Protocol -NoRestart -ErrorAction SilentlyContinue | Out-Null
Write-BaselineOk 'SMBv1 disabled (or already off)'

# Disable AutoPlay / AutoRun for non-volume devices
Set-RegistryDword -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer' -Name 'NoDriveTypeAutoRun' -Value 255
Write-BaselineOk 'AutoRun disabled'

# Require Windows Hello / password on wake from sleep (AC+DC)
powercfg /SETACVALUEINDEX SCHEME_CURRENT SUB_NONE CONSOLELOCK 1 | Out-Null
powercfg /SETDCVALUEINDEX SCHEME_CURRENT SUB_NONE CONSOLELOCK 1 | Out-Null
Write-BaselineOk 'Require sign-in on wake'

# Privacy: advertising ID, tailored experiences, diagnostic feedback to Required
Set-RegistryDword -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AdvertisingInfo' -Name 'Enabled' -Value 0
Set-RegistryDword -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\CloudContent' -Name 'DisableTailoredExperiencesWithDiagnosticData' -Value 1
Set-RegistryDword -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\DataCollection' -Name 'AllowTelemetry' -Value 1
Set-RegistryDword -Path 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Privacy' -Name 'TailoredExperiencesWithDiagnosticDataEnabled' -Value 0
Write-BaselineOk 'Telemetry set to Required; ads/tailoring off'

# Delivery Optimization: local network only (not internet peers)
Set-RegistryDword -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\DeliveryOptimization\Config' -Name 'DODownloadMode' -Value 1
Write-BaselineOk 'Delivery Optimization limited to LAN'

# BitLocker status (do not force-enable: needs TPM + user recovery key handling)
$bit = Get-BitLockerVolume -MountPoint $env:SystemDrive -ErrorAction SilentlyContinue
if ($bit -and $bit.ProtectionStatus -eq 'On') {
  Write-BaselineOk "BitLocker already on for $env:SystemDrive"
} else {
  Write-BaselineWarn "BitLocker is OFF for $env:SystemDrive — turn on in Settings > Privacy & security > Device encryption (save recovery key first)"
}

# Secure Boot / TPM presence (informational)
try {
  $sb = Confirm-SecureBootUEFI -ErrorAction Stop
  if ($sb) { Write-BaselineOk 'Secure Boot is enabled' } else { Write-BaselineWarn 'Secure Boot reports disabled' }
} catch {
  Write-BaselineWarn 'Could not query Secure Boot (VM/legacy firmware?)'
}

Write-BaselineWarn 'Controlled Folder Access left OFF (breaks many photo/video temp paths). Enable later if you accept app prompts.'
