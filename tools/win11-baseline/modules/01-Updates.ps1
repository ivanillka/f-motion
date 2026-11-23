#Requires -Version 5.1
<#
.SYNOPSIS
  Install pending Windows updates and reboot policy for a fresh machine.
#>
param(
  [switch]$WhatIf
)

. "$PSScriptRoot\Common.ps1"

Write-BaselineStep 'Windows Update'

if ($WhatIf) {
  Write-BaselineWarn 'WhatIf: would install NuGet provider, PSWindowsUpdate, and pending updates'
  return
}

# Prefer the inbox USOClient kick, then PSWindowsUpdate when available.
try {
  Start-Process -FilePath "$env:SystemRoot\System32\UsoClient.exe" -ArgumentList 'StartInteractiveScan' -Wait -NoNewWindow
  Write-BaselineOk 'Started Windows Update scan (UsoClient)'
} catch {
  Write-BaselineWarn "UsoClient scan failed: $($_.Exception.Message)"
}

$pswu = Get-Module -ListAvailable -Name PSWindowsUpdate | Select-Object -First 1
if (-not $pswu) {
  Write-BaselineStep 'Installing PSWindowsUpdate module'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force | Out-Null
  Set-PSRepository -Name PSGallery -InstallationPolicy Trusted
  Install-Module -Name PSWindowsUpdate -Force -Scope AllUsers -AllowClobber
}

Import-Module PSWindowsUpdate -Force
Write-BaselineStep 'Installing all pending Microsoft updates (may reboot)'
Get-WindowsUpdate -MicrosoftUpdate -AcceptAll -Install -IgnoreReboot | Out-Null
Write-BaselineOk 'Update pass complete (reboot separately if pending)'
