#!/usr/bin/env node

/**
 * check-build.mjs — Build artifact verification.
 *
 * Verifies:
 * 1. `npm run build` succeeds
 * 2. `dist/chromium-mv3/` exists with expected structure
 * 3. Built `manifest.json` is valid JSON with Manifest V3
 * 4. Bundle size is within the 15MB limit
 * 5. No `eval()` or `new Function()` in built JS files
 * 6. All icon files referenced in manifest actually exist
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBundleSize } from '../../scripts/check-bundle-size.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');
const DIST_DIR = join(ROOT_DIR, 'dist', 'chromium-mv3');

const { header, pass, fail, warn, info, sectionBreak, summary } = await import('./utils/reporter.mjs');

function runBundleSizeCheck() {
  sectionBreak();
  info('Checking bundle size...');

  try {
    const result = checkBundleSize({
      totalBytes: dirSizeBytes(DIST_DIR),
      maxBytes: 15 * 1024 * 1024,
    });
    if (result.ok) {
      pass(result.message);
      return true;
    } else {
      fail(result.message);
      return false;
    }
  } catch (e) {
    fail(`Bundle size check failed: ${e.message}`);
    return false;
  }
}

function dirSizeBytes(dirPath) {
  let total = 0;
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += dirSizeBytes(fullPath);
    } else {
      total += statSync(fullPath).size;
    }
  }
  return total;
}

function runBuild() {
  header('Build Verification');
  info('Running `npm run build`...');

  const result = spawnSync('npm', ['run', 'build'], {
    cwd: ROOT_DIR,
    stdio: 'pipe',
    encoding: 'utf-8',
  });

  if (result.status !== 0) {
    fail('`npm run build` failed');
    if (result.stdout) info(result.stdout.slice(-500));
    if (result.stderr) info(result.stderr.slice(-500));
    return false;
  }

  pass('`npm run build` succeeded');
  return true;
}

function checkDistStructure() {
  sectionBreak();
  info('Checking dist/chromium-mv3 structure...');

  if (!existsSync(DIST_DIR)) {
    fail('dist/chromium-mv3/ does not exist');
    return false;
  }

  const required = [
    'manifest.json',
    'background.js',
    'popup.html',
    'options.html',
    'offscreen.html',
    'content-scripts',
    'icons',
    '_locales',
  ];

  const missing = required.filter((f) => !existsSync(join(DIST_DIR, f)));
  if (missing.length > 0) {
    fail(`Missing build artifacts: ${missing.join(', ')}`);
    return false;
  }

  pass('All required build artifacts present');
  return true;
}

function checkBuiltManifest() {
  sectionBreak();
  info('Checking built manifest.json...');

  const manifestPath = join(DIST_DIR, 'manifest.json');
  if (!existsSync(manifestPath)) {
    fail('Built manifest.json not found');
    return false;
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch (e) {
    fail(`Built manifest.json is invalid JSON: ${e.message}`);
    return false;
  }

  pass('Built manifest.json is valid JSON');

  if (manifest.manifest_version !== 3) {
    fail(`manifest_version is ${manifest.manifest_version}, expected 3`);
    return false;
  }
  pass('manifest_version is 3 (Manifest V3)');

  if (!manifest.background || manifest.background.scripts) {
    fail('Manifest uses V2 background.scripts instead of service_worker');
    return false;
  }
  if (manifest.background && manifest.background.service_worker) {
    pass('Uses service_worker (Manifest V3 compliant)');
  } else {
    fail('No service_worker found in manifest');
    return false;
  }

  if (!manifest.action) {
    fail('Missing "action" key in manifest (required for chrome.action API)');
    return false;
  }
  pass('"action" key present in manifest');

  if (manifest.content_security_policy) {
    pass('Content-Security-Policy is defined');
  } else {
    warn('No content_security_policy found in manifest');
  }

  return true;
}

function checkNoEval() {
  sectionBreak();
  info('Scanning built JS files for eval() / new Function()...');

  const jsFiles = [];
  function collectJs(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        collectJs(fullPath);
      } else if (entry.name.endsWith('.js')) {
        jsFiles.push(fullPath);
      }
    }
  }
  collectJs(DIST_DIR);

  const evalPattern = /\beval\s*\(|\bnew\s+Function\s*\(/g;
  const violations = [];

  for (const file of jsFiles) {
    const content = readFileSync(file, 'utf-8');
    // Skip source maps
    if (file.endsWith('.js.map')) continue;
    const matches = content.match(evalPattern);
    if (matches) {
      violations.push({ file: join('dist/chromium-mv3', file.replace(DIST_DIR + '/', '')), count: matches.length });
    }
  }

  if (violations.length > 0) {
    fail(`Found eval()/new Function() in ${violations.length} built file(s):`);
    for (const v of violations.slice(0, 10)) {
      info(`  ${v.file}: ${v.count} occurrence(s)`);
    }
    return false;
  }

  pass('No eval() or new Function() found in built JS files');
  return true;
}

function checkIconsExist() {
  sectionBreak();
  info('Checking icon files...');

  const manifestPath = join(DIST_DIR, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  if (!manifest.icons) {
    warn('No icons declared in manifest');
    return true;
  }

  const iconDir = join(DIST_DIR, 'icons');
  const missing = [];

  for (const [size, path] of Object.entries(manifest.icons)) {
    const fullPath = join(DIST_DIR, path);
    if (!existsSync(fullPath)) {
      missing.push(`${size}x${size} (${path})`);
    }
  }

  if (missing.length > 0) {
    fail(`Missing icon files: ${missing.join(', ')}`);
    return false;
  }

  pass('All declared icon files exist');
  return true;
}

function main() {
  const results = [];

  // Step 1: Build
  const buildOk = runBuild();
  results.push({ name: 'Build', ok: buildOk });
  if (!buildOk) {
    summary();
    process.exit(1);
  }

  // Step 2: Dist structure
  results.push({ name: 'Dist Structure', ok: checkDistStructure() });

  // Step 3: Built manifest
  results.push({ name: 'Built Manifest', ok: checkBuiltManifest() });

  // Step 4: Bundle size
  results.push({ name: 'Bundle Size', ok: runBundleSizeCheck() });

  // Step 5: No eval
  results.push({ name: 'No Eval', ok: checkNoEval() });

  // Step 6: Icons
  results.push({ name: 'Icons', ok: checkIconsExist() });

  sectionBreak();
  const allPassed = summary();
  process.exit(allPassed ? 0 : 1);
}

main();
