#!/usr/bin/env node
/**
 * Structure check for the Win11 baseline kit (runs on any OS).
 * Fails if required files, remove-list entries, or winget package ids are missing/malformed.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const required = [
  'README.md',
  'Invoke-Win11Baseline.ps1',
  'Run-All.cmd',
  'modules/Common.ps1',
  'modules/01-Updates.ps1',
  'modules/02-Security.ps1',
  'modules/03-Debloat.ps1',
  'modules/04-Performance.ps1',
  'modules/05-CreativeReady.ps1',
  'modules/06-BitLocker.ps1',
  'modules/07-Services.ps1',
  'config/remove-apps.txt',
  'config/packages.winget.json',
];

const missing = required.filter((rel) => !existsSync(join(root, rel)));
if (missing.length) {
  console.error('Missing required files:\n' + missing.map((m) => `  - ${m}`).join('\n'));
  process.exit(1);
}

const orchestrator = readFileSync(join(root, 'Invoke-Win11Baseline.ps1'), 'utf8');
for (const token of [
  'Assert-Administrator',
  '01-Updates.ps1',
  '02-Security.ps1',
  '03-Debloat.ps1',
  '04-Performance.ps1',
  '05-CreativeReady.ps1',
  '06-BitLocker.ps1',
  '07-Services.ps1',
  'SkipPackages',
  'SkipBitLocker',
]) {
  if (!orchestrator.includes(token)) {
    console.error(`Orchestrator missing expected token: ${token}`);
    process.exit(1);
  }
}

// Default must install packages (opt-out via SkipPackages, not opt-in)
if (orchestrator.includes('InstallCreativeTools')) {
  console.error('Orchestrator still uses opt-in InstallCreativeTools; full pass should default to installing packages');
  process.exit(1);
}

const creative = readFileSync(join(root, 'modules/05-CreativeReady.ps1'), 'utf8');
if (!creative.includes('SkipPackages') || !creative.includes('Media')) {
  console.error('05-CreativeReady.ps1 must create Media folders and support SkipPackages');
  process.exit(1);
}

const removeList = readFileSync(join(root, 'config/remove-apps.txt'), 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));
if (removeList.length < 5) {
  console.error(`remove-apps.txt looks empty (${removeList.length} entries)`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(root, 'config/packages.winget.json'), 'utf8'));
const packages = pkg?.Sources?.[0]?.Packages;
if (!Array.isArray(packages) || packages.length < 15) {
  console.error('packages.winget.json must list a full creative stack (15+ identifiers)');
  process.exit(1);
}
for (const p of packages) {
  if (!p.PackageIdentifier || !/^[A-Za-z0-9][A-Za-z0-9.+_-]+$/.test(p.PackageIdentifier)) {
    console.error(`Invalid PackageIdentifier: ${JSON.stringify(p)}`);
    process.exit(1);
  }
}

const bannedRemovals = ['Microsoft.Windows.Photos', 'Microsoft.WindowsCamera', 'Microsoft.Paint', 'Microsoft.WindowsStore'];
for (const banned of bannedRemovals) {
  if (removeList.some((n) => n === banned || n.includes(banned))) {
    console.error(`remove-apps.txt must not target kept creative/shell app: ${banned}`);
    process.exit(1);
  }
}

const bitlocker = readFileSync(join(root, 'modules/06-BitLocker.ps1'), 'utf8');
if (!bitlocker.includes('Enable-BitLocker') || !bitlocker.includes('BitLocker-Recovery-KEY.txt')) {
  console.error('06-BitLocker.ps1 must enable BitLocker and write a recovery key file');
  process.exit(1);
}

console.log(`Win11 baseline kit OK (FULL: ${removeList.length} remove targets, ${packages.length} winget packages)`);
