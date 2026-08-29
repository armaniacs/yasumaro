#!/usr/bin/env node

/**
 * check-e2e.mjs — Playwright E2E test verification.
 *
 * Verifies:
 * 1. Playwright tests pass (using the extension project)
 *
 * Note: E2E tests require a browser environment and can be slow.
 * This script is separate from the main release:check so it can be
 * run independently or skipped in quick release checks.
 */

import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');

const { header, pass, fail, warn, info, sectionBreak, summary } = await import('./utils/reporter.mjs');

function runE2ETests() {
  header('E2E Tests (Playwright)');
  info('Running `npm run test:e2e:ci` (extension-tagged tests)...');

  // Check if xvfb-run is available (needed for headless CI)
  const xvfbCheck = spawnSync('command', ['-v', 'xvfb-run'], { encoding: 'utf-8' });
  if (xvfbCheck.status !== 0) {
    warn('xvfb-run not found — E2E tests require a display server');
    warn('Install xvfb or run E2E tests manually with `npm run test:e2e:headed`');
    return true; // Non-blocking in CI environments without display
  }

  const result = spawnSync('npm', ['run', 'test:e2e:ci'], {
    cwd: ROOT_DIR,
    stdio: 'pipe',
    encoding: 'utf-8',
    env: { ...process.env, CI: '1' },
  });

  if (result.status !== 0) {
    fail('E2E tests failed');
    if (result.stdout) info(result.stdout.slice(-1000));
    if (result.stderr) info(result.stderr.slice(-1000));
    return false;
  }

  pass('All E2E tests passed');
  return true;
}

function checkPlaywrightInstallation() {
  sectionBreak();
  info('Checking Playwright installation...');

  const result = spawnSync('npx', ['playwright', '--version'], {
    cwd: ROOT_DIR,
    encoding: 'utf-8',
    stdio: 'pipe',
  });

  if (result.status === 0) {
    pass(`Playwright installed: ${result.stdout.trim()}`);
    return true;
  }

  warn('Playwright may not be fully installed (browsers missing?)');
  warn('Run `npx playwright install --with-deps` if needed');
  return true;
}

function main() {
  checkPlaywrightInstallation();
  const e2eOk = runE2ETests();

  sectionBreak();
  const allPassed = summary();
  process.exit(allPassed ? 0 : 1);
}

main();
