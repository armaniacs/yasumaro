#!/usr/bin/env node

/**
 * Check if the htmlparser2 override in package.json can be safely removed.
 *
 * The override was added to pin htmlparser2 to ^12.0.0 to resolve a dependency
 * conflict. This script tests whether the override is still needed by:
 * 1. Removing the override temporarily
 * 2. Running npm install
 * 3. Running npm test
 * 4. Restoring the override
 *
 * Exit codes:
 *   0 - Override can be safely removed
 *   1 - Override is still needed (tests failed without it)
 *   2 - Script error
 */

import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

function run(cmd, opts = {}) {
  try {
    execSync(cmd, { cwd: ROOT_DIR, stdio: 'pipe', ...opts });
    return { ok: true };
  } catch (e) {
    return { ok: false, stderr: e.stderr?.toString() || '', stdout: e.stdout?.toString() || '' };
  }
}

console.log('🔍 Checking if htmlparser2 override can be removed...\n');

const pkgPath = join(ROOT_DIR, 'package.json');
const lockBackupPath = join(ROOT_DIR, 'package-lock.json.check-htmlparser2-backup');
const pkgBackupPath = join(ROOT_DIR, 'package.json.check-htmlparser2-backup');

try {
  copyFileSync(join(ROOT_DIR, 'package-lock.json'), lockBackupPath);
  copyFileSync(pkgPath, pkgBackupPath);
} catch (e) {
  console.error('❌ Failed to backup files:', e.message);
  process.exit(2);
}

try {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

  if (!pkg.overrides?.htmlparser2) {
    console.log('✅ No htmlparser2 override found — nothing to check.');
    process.exit(0);
  }

  const originalOverride = pkg.overrides.htmlparser2;
  console.log(`Current override: htmlparser2 → ${originalOverride}`);

  delete pkg.overrides.htmlparser2;
  if (Object.keys(pkg.overrides).length === 0) {
    delete pkg.overrides;
  }
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

  console.log('\n📦 Running npm install without override...');
  const installResult = run('npm install');
  if (!installResult.ok) {
    console.log('\n❌ npm install failed without override — override is still needed.');
    console.log(installResult.stderr?.slice(0, 500));
    process.exit(1);
  }

  console.log('🧪 Running tests without override...');
  const testResult = run('npm test');
  if (!testResult.ok) {
    console.log('\n❌ Tests failed without htmlparser2 override — override is still needed.');
    const output = (testResult.stdout + '\n' + testResult.stderr).slice(-1000);
    console.log(output);
    process.exit(1);
  }

  console.log('\n✅ htmlparser2 override can be safely removed!');
  console.log('   Remove "overrides.htmlparser2" from package.json and run npm install.');
  process.exit(0);
} finally {
  copyFileSync(pkgBackupPath, pkgPath);
  copyFileSync(lockBackupPath, join(ROOT_DIR, 'package-lock.json'));

  try {
    const { unlinkSync } = await import('fs');
    unlinkSync(lockBackupPath);
    unlinkSync(pkgBackupPath);
  } catch {}

  run('npm install --prefer-offline');
}
