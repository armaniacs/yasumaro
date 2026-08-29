#!/usr/bin/env node

/**
 * check-deps.mjs — Dependency & security verification.
 *
 * Verifies:
 * 1. `npm audit` — no critical or high vulnerabilities
 * 2. Major dependency versions are not severely outdated (warn-level)
 * 3. License compliance (reuses existing check-licenses.mjs)
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import checker from 'license-checker';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');

const { header, pass, fail, warn, info, sectionBreak, summary } = await import('./utils/reporter.mjs');

function checkNpmAudit() {
  header('npm Audit');
  info('Running `npm audit`...');

  try {
    const result = execSync('npm audit --json', {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const audit = JSON.parse(result);
    const vulnerabilities = audit.vulnerabilities || {};
    const critical = Object.values(vulnerabilities).filter((v) => v.severity === 'critical').length;
    const high = Object.values(vulnerabilities).filter((v) => v.severity === 'high').length;

    if (critical > 0) {
      fail(`Found ${critical} critical vulnerability(ies)`);
      return false;
    }
    if (high > 0) {
      fail(`Found ${high} high severity vulnerability(ies)`);
      return false;
    }

    pass('No critical or high vulnerabilities found');
    return true;
  } catch (e) {
    // npm audit exits with code 1 when vulnerabilities are found
    try {
      const audit = JSON.parse(e.stdout || e.message);
      const vulnerabilities = audit.vulnerabilities || {};
      const critical = Object.values(vulnerabilities).filter((v) => v.severity === 'critical').length;
      const high = Object.values(vulnerabilities).filter((v) => v.severity === 'high').length;

      if (critical > 0) {
        fail(`Found ${critical} critical vulnerability(ies)`);
        for (const [name, v] of Object.entries(vulnerabilities)) {
          if (v.severity === 'critical' || v.severity === 'high') {
            info(`  ${name}: ${v.severity} — ${v.via || v.effectiveness || 'no details'}`);
          }
        }
        return false;
      }
      if (high > 0) {
        fail(`Found ${high} high severity vulnerability(ies)`);
        for (const [name, v] of Object.entries(vulnerabilities)) {
          if (v.severity === 'high') {
            info(`  ${name}: ${v.severity} — ${v.via || v.effectiveness || 'no details'}`);
          }
        }
        return false;
      }

      // Only low/moderate — pass with info
      pass('No critical or high vulnerabilities (only low/moderate)');
      return true;
    } catch {
      fail(`npm audit failed unexpectedly: ${e.message}`);
      return false;
    }
  }
}

function checkOutdatedDeps() {
  sectionBreak();
  info('Checking for outdated major dependencies...');

  const pkg = JSON.parse(readFileSync(join(ROOT_DIR, 'package.json'), 'utf-8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  const criticalPackages = [
    'wxt',
    '@subframe7536/sqlite-wasm',
    'vitest',
    '@playwright/test',
    'typescript',
    'vite',
    'eslint',
    'wa-sqlite',
  ];

  try {
    const result = execSync('npm outdated --json', {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });

    const outdated = JSON.parse(result);
    const majorOutdated = [];

    for (const [name, info] of Object.entries(outdated)) {
      if (criticalPackages.includes(name)) {
        const current = info.current.split('.')[0];
        const wanted = info.wanted.split('.')[0];
        if (current !== wanted) {
          majorOutdated.push(`${name}: current=${info.current}, wanted=${info.wanted}`);
        }
      }
    }

    if (majorOutdated.length > 0) {
      warn(`${majorOutdated.length} critical package(s) have major updates available:`);
      for (const item of majorOutdated) {
        info(`  ${item}`);
      }
      return true; // Warning only
    }

    pass('No major version drift on critical dependencies');
    return true;
  } catch (e) {
    // npm outdated exits with code 1 when outdated packages exist
    try {
      const outdated = JSON.parse(e.stdout || e.message);
      const criticalPackages = [
        'wxt',
        '@subframe7536/sqlite-wasm',
        'vitest',
        '@playwright/test',
        'typescript',
        'vite',
        'eslint',
        'wa-sqlite',
      ];

      const majorOutdated = [];
      for (const [name, info] of Object.entries(outdated)) {
        if (criticalPackages.includes(name)) {
          const current = info.current.split('.')[0];
          const wanted = info.wanted.split('.')[0];
          if (current !== wanted) {
            majorOutdated.push(`${name}: current=${info.current}, wanted=${info.wanted}`);
          }
        }
      }

      if (majorOutdated.length > 0) {
        warn(`${majorOutdated.length} critical package(s) have major updates available:`);
        for (const item of majorOutdated) {
          info(`  ${item}`);
        }
      } else {
        pass('No major version drift on critical dependencies');
      }
      return true;
    } catch {
      warn('Could not parse npm outdated output (no network or npm error)');
      return true; // Non-blocking
    }
  }
}

function checkLicenses() {
  sectionBreak();
  info('Running license compliance check...');

  try {
    const result = execSync('node scripts/check-licenses.mjs', {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    pass(result.trim());
    return true;
  } catch (e) {
    fail('License check failed');
    if (e.stdout) info(e.stdout.slice(-300));
    if (e.stderr) info(e.stderr.slice(-300));
    return false;
  }
}

function main() {
  const results = [];

  results.push({ name: 'npm Audit', ok: checkNpmAudit() });
  results.push({ name: 'Outdated Deps', ok: checkOutdatedDeps() });
  results.push({ name: 'Licenses', ok: checkLicenses() });

  sectionBreak();
  const allPassed = summary();
  process.exit(allPassed ? 0 : 1);
}

main();
