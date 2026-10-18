#Requires -Version 5.1
<#
.SYNOPSIS
  Shared helpers for the Win11 baseline kit.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-BaselineStep {
  param([Parameter(Mandatory)][string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-BaselineOk {
  param([Parameter(Mandatory)][string]$Message)
  Write-Host "  OK  $Message" -ForegroundColor Green
}

function Write-BaselineWarn {
  param([Parameter(Mandatory)][string]$Message)
  Write-Host "  WARN  $Message" -ForegroundColor Yellow
}

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this script from an elevated PowerShell (Run as administrator).'
  }
}

function Set-RegistryDword {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][int]$Value
  )
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -Path $Path -Force | Out-Null
  }
  New-ItemProperty -LiteralPath $Path -Name $Name -PropertyType DWord -Value $Value -Force | Out-Null
}

# Captured at dot-source time so helpers keep working when called from the orchestrator.
$script:Win11BaselineModulesDir = $PSScriptRoot

function Get-BaselineRoot {
  Split-Path -Parent $script:Win11BaselineModulesDir
}
