@echo off
:: Double-click / Run as administrator — full Win11 baseline
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo Requesting administrator...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
echo.
echo Running FULL Win11 baseline...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Invoke-Win11Baseline.ps1"
echo.
pause
