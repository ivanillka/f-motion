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
  'modules/Common.ps1',
  'modules/01-Updates.ps1',
  'modules/02-Security.ps1',
  'modules/03-Debloat.ps1',
  'modules/04-Performance.ps1',
  'modules/05-CreativeReady.ps1',
  'config/remove-apps.txt',
  'config/packages.winget.json',
];

const missing = required.filter((rel) => !existsSync(join(root, rel)));
if (missing.length) {
  console.error('Missing required files:\n' + missing.map((m) => `  - ${m}`).join('\n'));
  process.exit(1);
}

const orchestrator = readFileSync(join(root, 'Invoke-Win11Baseline.ps1'), 'utf8');
for (const token of ['Assert-Administrator', '01-Updates.ps1', '02-Security.ps1', '03-Debloat.ps1', '04-Performance.ps1', '05-CreativeReady.ps1', 'InstallCreativeTools']) {
  if (!orchestrator.includes(token)) {
    console.error(`Orchestrator missing expected token: ${token}`);
    process.exit(1);
  }
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
if (!Array.isArray(packages) || packages.length < 3) {
  console.error('packages.winget.json must list at least 3 package identifiers');
  process.exit(1);
}
for (const p of packages) {
  if (!p.PackageIdentifier || !/^[A-Za-z0-9][A-Za-z0-9._-]+$/.test(p.PackageIdentifier)) {
    console.error(`Invalid PackageIdentifier: ${JSON.stringify(p)}`);
    process.exit(1);
  }
}

// Kept-apps guard: ensure we did not list core creative shells for removal
const bannedRemovals = ['Microsoft.Windows.Photos', 'Microsoft.WindowsCamera', 'Microsoft.Paint', 'Microsoft.WindowsStore'];
for (const banned of bannedRemovals) {
  if (removeList.some((n) => n === banned || n.includes(banned))) {
    console.error(`remove-apps.txt must not target kept creative/shell app: ${banned}`);
    process.exit(1);
  }
}

console.log(`Win11 baseline kit OK (${removeList.length} remove targets, ${packages.length} winget packages)`);
