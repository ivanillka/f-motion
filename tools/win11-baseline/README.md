# Win11 baseline kit

Reusable prep for a **fresh Windows 11** install before you customize each machine.
Goal: updated, secured, light, and ready for photo / video work — then layer
Adobe, DaVinci, Capture One, etc. yourself.

## Run (elevated PowerShell)

```powershell
cd path\to\tools\win11-baseline
Set-ExecutionPolicy -Scope Process Bypass
.\Invoke-Win11Baseline.ps1
```

Optional:

```powershell
# Preview only
.\Invoke-Win11Baseline.ps1 -WhatIf

# Also install winget creative utilities (GIMP, Blender, FFmpeg, VLC, 7zip, …)
.\Invoke-Win11Baseline.ps1 -InstallCreativeTools

# Skip the update pass (already patched)
.\Invoke-Win11Baseline.ps1 -SkipUpdates -InstallCreativeTools
```

Reboot when prompted, then install **GPU drivers from the vendor** (NVIDIA / AMD / Intel).

## What it does

| Step | Effect |
|------|--------|
| Updates | Scan + install pending Microsoft updates (`PSWindowsUpdate`) |
| Security | Defender on, firewall on, SmartScreen, UAC, SMBv1 off, AutoRun off, telemetry Required, BitLocker status check |
| Debloat | Remove consumer/OEM apps listed in `config/remove-apps.txt` (keeps Store, Photos, Camera, Paint, Calculator) |
| Performance | Ultimate/High Performance plan, AC sleep off, HAGS on, Storage Sense off, Game DVR off |
| Creative | Show extensions/hidden files, long paths; optional winget import |

**Not** forced: BitLocker enable, Controlled Folder Access (breaks many editors), Adobe/DaVinci installs.

## Customize per fleet

- Edit `config/remove-apps.txt` for OEM junk unique to a SKU.
- Edit `config/packages.winget.json` for your shared utility set.
- Keep vendor creative suites out of winget — install from your accounts after this baseline.

## Verify kit structure (from repo root, any OS)

```sh
node tools/win11-baseline/validate.mjs
```
