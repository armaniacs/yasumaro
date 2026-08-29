#!/usr/bin/env node

/**
 * check-release-metadata.mjs — Release metadata verification.
 *
 * Verifies:
 * 1. package.json version matches manifest.json version
 * 2. package.json version matches wxt.config.ts version (pkg.version SSOT)
 * 3. package.json version matches docs/version.json
 * 4. Git tag for current version exists (e.g., "v6.7.87" or "6.7.87")
 * 5. Git working tree is clean (no uncommitted changes)
 * 6. CHANGELOG.md has entry for current version
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');

const { header, pass, fail, warn, info, sectionBreak, summary } = await import('./utils/reporter.mjs');

function readPkgVersion() {
  const pkg = JSON.parse(readFileSync(join(ROOT_DIR, 'package.json'), 'utf-8'));
  return pkg.version;
}

function extractVersionFromManifest() {
  const manifestPath = join(ROOT_DIR, 'dist', 'chromium-mv3', 'manifest.json');
  if (!existsSync(manifestPath)) {
    return null;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  return manifest.version;
}

function extractVersionFromWxtConfig() {
  const configPath = join(ROOT_DIR, 'wxt.config.ts');
  const content = readFileSync(configPath, 'utf-8');
  // wxt.config.ts uses pkg.version as SSOT
  if (content.includes('pkg.version')) {
    return readPkgVersion(); // SSOT
  }
  const match = content.match(/version:\s*['"]([^'"]+)['"]/);
  return match ? match[1] : null;
}

function extractVersionFromDocsVersion() {
  const path = join(ROOT_DIR, 'docs', 'version.json');
  if (!existsSync(path)) {
    return null;
  }
  const content = readFileSync(path, 'utf-8');
  const match = content.match(/"version"\s*:\s*"([^"]+)"/);
  return match ? match[1] : null;
}

function checkVersionConsistency() {
  header('Version Consistency');
  const version = readPkgVersion();
  info(`Current version: ${version}`);

  const checks = [
    { name: 'package.json', value: version },
    { name: 'manifest.json', value: extractVersionFromManifest() },
    { name: 'wxt.config.ts', value: extractVersionFromWxtConfig() },
    { name: 'docs/version.json', value: extractVersionFromDocsVersion() },
  ];

  const values = checks.filter((c) => c.value !== null).map((c) => c.value);
  const unique = [...new Set(values)];

  for (const c of checks) {
    if (c.value === null) {
      warn(`${c.name}: not found or could not extract version`);
    } else if (c.value === version) {
      pass(`${c.name}: ${c.value}`);
    } else {
      fail(`${c.name}: ${c.value} (expected ${version})`);
    }
  }

  if (unique.length === 1 && unique[0] === version) {
    pass('All version files are consistent');
    return true;
  }

  fail('Version mismatch detected across files');
  return false;
}

function checkGitTag() {
  sectionBreak();
  info('Checking git tag for current version...');

  const version = readPkgVersion();
  const possibleTags = [`v${version}`, version];

  try {
    const tags = execSync('git tag -l', { encoding: 'utf-8', cwd: ROOT_DIR }).trim().split('\n');

    for (const tag of possibleTags) {
      if (tags.includes(tag)) {
        pass(`Git tag found: ${tag}`);
        return true;
      }
    }

    warn(`No git tag found for version ${version} (expected: ${possibleTags.join(' or ')})`);
    warn('Run `git tag <version> && git push origin <version>` to create the tag');
    return true; // Warning only — tag may be created after checks
  } catch (e) {
    warn(`Could not check git tags: ${e.message}`);
    return true;
  }
}

function checkGitClean() {
  sectionBreak();
  info('Checking git working tree...');

  try {
    const status = execSync('git status --porcelain', {
      encoding: 'utf-8',
      cwd: ROOT_DIR,
    }).trim();

    if (status) {
      warn('Working tree has uncommitted changes:');
      for (const line of status.split('\n')) {
        info(`  ${line}`);
      }
      warn('Release should be made from a clean working tree');
      return true; // Warning only
    }

    pass('Working tree is clean');
    return true;
  } catch (e) {
    warn(`Could not check git status: ${e.message}`);
    return true;
  }
}

function checkChangelog() {
  sectionBreak();
  info('Checking CHANGELOG.md...');

  const version = readPkgVersion();
  const changelogPath = join(ROOT_DIR, 'CHANGELOG.md');

  if (!existsSync(changelogPath)) {
    fail('CHANGELOG.md not found');
    return false;
  }

  const changelog = readFileSync(changelogPath, 'utf-8');
  const versionPattern = new RegExp(`##\\s+\\[?${version.replace(/\./g, '\\.')}\\]?`, 'i');

  if (versionPattern.test(changelog)) {
    pass(`CHANGELOG.md has entry for version ${version}`);
    return true;
  }

  if (changelog.includes(version)) {
    pass(`CHANGELOG.md mentions version ${version}`);
    return true;
  }

  warn(`CHANGELOG.md does not have a clear entry for version ${version}`);
  return true;
}

function main() {
  const results = [];

  results.push({ name: 'Version Consistency', ok: checkVersionConsistency() });
  results.push({ name: 'Git Tag', ok: checkGitTag() });
  results.push({ name: 'Git Clean', ok: checkGitClean() });
  results.push({ name: 'CHANGELOG', ok: checkChangelog() });

  sectionBreak();
  const allPassed = summary();
  process.exit(allPassed ? 0 : 1);
}

main();
