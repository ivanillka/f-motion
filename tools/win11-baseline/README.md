# Win11 baseline kit — full pass

One elevated run prepares a **fresh Windows 11** for every machine: updates,
security, BitLocker (when TPM allows), light debloat, performance, service trim,
`~/Media` folders, and the full creative utility stack via winget.

## Do everything

Right-click **`Run-All.cmd` → Run as administrator**, or:

```powershell
cd path\to\tools\win11-baseline
Set-ExecutionPolicy -Scope Process Bypass
.\Invoke-Win11Baseline.ps1
```

That single command runs **all** steps (including winget packages + BitLocker).

Escapes (rarely needed):

```powershell
.\Invoke-Win11Baseline.ps1 -WhatIf
.\Invoke-Win11Baseline.ps1 -SkipUpdates
.\Invoke-Win11Baseline.ps1 -SkipPackages
.\Invoke-Win11Baseline.ps1 -SkipBitLocker
```

Afterward: **reboot** → install **GPU drivers from NVIDIA/AMD/Intel** → sign into Adobe / DaVinci / Capture One.

If BitLocker enabled: copy `Desktop\BitLocker-Recovery-KEY.txt` to a USB/password manager, then delete the Desktop copy.

## What the full pass does

| Step | Effect |
|------|--------|
| Updates | Install pending Microsoft updates |
| Security | Defender, firewall, SmartScreen, UAC, SMBv1/AutoRun off, Required telemetry, Remote Assistance off |
| BitLocker | Enable on system drive when TPM ready; write recovery key to Desktop |
| Debloat | Remove consumer/OEM apps in `config/remove-apps.txt` (keeps Store/Photos/Camera/Paint) |
| Performance | Ultimate/High Performance, AC sleep off, HAGS, Storage Sense off, Game DVR off |
| Services | Disable Xbox/RemoteRegistry/RetailDemo/etc.; keep SysMain + Search |
| Creative | `Media\{Inbox,Projects,Exports,…}`, long paths, Copilot off, winget stack (GIMP, darktable, Krita, Blender, HandBrake, OBS, FFmpeg, …) |

## Customize per fleet

- `config/remove-apps.txt` — OEM junk
- `config/packages.winget.json` — shared utilities (vendor suites stay out on purpose)

## Verify kit structure (any OS)

```sh
node tools/win11-baseline/validate.mjs
```
