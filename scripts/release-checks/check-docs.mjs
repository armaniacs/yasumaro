#!/usr/bin/env node

/**
 * check-docs.mjs — Documentation consistency verification.
 *
 * Verifies:
 * 1. README.md badge URLs and installation links are valid
 * 2. docs/*.md files referenced in README actually exist
 * 3. docs/version.json exists and matches package.json version
 * 4. CHANGELOG.md has an entry for the current version
 * 5. AGENTS.md file paths in tables match actual files
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');

const { header, pass, fail, warn, info, sectionBreak, summary } = await import('./utils/reporter.mjs');

function readPkgVersion() {
  const pkg = JSON.parse(readFileSync(join(ROOT_DIR, 'package.json'), 'utf-8'));
  return pkg.version;
}

function checkReadmeLinks() {
  header('README.md Links');
  const readme = readFileSync(join(ROOT_DIR, 'README.md'), 'utf-8');

  // Extract markdown links: [text](url)
  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  const links = [];
  let match;
  while ((match = linkPattern.exec(readme)) !== null) {
    links.push({ text: match[1], url: match[2] });
  }

  // Check badge URLs (img.shields.io)
  const badgePattern = /https:\/\/img\.shields\.io\/badge\/[^"\s]+/g;
  const badgeUrls = [];
  let bmatch;
  while ((bmatch = badgePattern.exec(readme)) !== null) {
    badgeUrls.push(bmatch[0]);
  }

  // Basic URL format validation (no network fetch)
  const invalidLinks = [];
  for (const link of links) {
    if (link.url.startsWith('http') && !link.url.startsWith('https://')) {
      invalidLinks.push(`Non-HTTPS: ${link.text} → ${link.url}`);
    }
  }

  if (invalidLinks.length > 0) {
    warn(`Found ${invalidLinks.length} non-HTTPS link(s):`);
    for (const l of invalidLinks) info(`  ${l}`);
  } else {
    pass('All README links use HTTPS');
  }

  // Check Chrome Web Store and Edge Add-ons links exist
  const storeLinks = links.filter((l) =>
    l.url.includes('chromewebstore.google.com') || l.url.includes('microsoftedge.microsoft.com')
  );
  if (storeLinks.length >= 1) {
    pass(`Found ${storeLinks.length} store link(s) in README`);
  } else {
    warn('No store links found in README');
  }

  return true;
}

function checkDocsFilesExist() {
  sectionBreak();
  info('Checking referenced docs/*.md and dev-docs/*.md files...');

  const readme = readFileSync(join(ROOT_DIR, 'README.md'), 'utf-8');
  const docsDir = join(ROOT_DIR, 'docs');
  const devDocsDir = join(ROOT_DIR, 'dev-docs');

  // Extract docs/*.md and dev-docs/*.md references
  const docsPattern = /(?:docs|dev-docs)\/([A-Za-z0-9_-]+\.md)/g;
  const referencedDocs = new Map(); // filename -> directory prefix
  let match;
  while ((match = docsPattern.exec(readme)) !== null) {
    const prefix = match[0].includes('dev-docs') ? 'dev-docs' : 'docs';
    referencedDocs.set(match[1], prefix);
  }

  // Also check AGENTS.md references
  const agentsPath = join(ROOT_DIR, 'AGENTS.md');
  if (existsSync(agentsPath)) {
    const agentsContent = readFileSync(agentsPath, 'utf-8');
    const agentsDocsPattern = /(?:docs|dev-docs)\/([A-Za-z0-9_-]+\.md)/g;
    let amatch;
    while ((amatch = agentsDocsPattern.exec(agentsContent)) !== null) {
      const prefix = amatch[0].includes('dev-docs') ? 'dev-docs' : 'docs';
      if (!referencedDocs.has(amatch[1])) {
        referencedDocs.set(amatch[1], prefix);
      }
    }
  }

  const missing = [];
  for (const [doc, prefix] of referencedDocs) {
    const dir = prefix === 'dev-docs' ? devDocsDir : docsDir;
    if (!existsSync(join(dir, doc))) {
      missing.push(`${prefix}/${doc}`);
    }
  }

  if (missing.length > 0) {
    fail(`Referenced docs files missing: ${missing.join(', ')}`);
    return false;
  }

  pass(`All ${referencedDocs.size} referenced docs files exist`);
  return true;
}

function checkVersionConsistency() {
  sectionBreak();
  info('Checking version consistency...');

  const version = readPkgVersion();
  const checks = [
    { file: 'package.json', path: join(ROOT_DIR, 'package.json') },
    { file: 'docs/version.json', path: join(ROOT_DIR, 'docs', 'version.json') },
  ];

  const versions = {};
  for (const c of checks) {
    if (!existsSync(c.path)) {
      fail(`${c.file} not found`);
      return false;
    }
    const content = readFileSync(c.path, 'utf-8');
    const match = content.match(/"version"\s*:\s*"([^"]+)"/);
    if (!match) {
      fail(`Could not extract version from ${c.file}`);
      return false;
    }
    versions[c.file] = match[1];
  }

  const unique = [...new Set(Object.values(versions))];
  if (unique.length === 1 && unique[0] === version) {
    pass(`All version files consistent: ${version}`);
    return true;
  }

  fail('Version mismatch detected');
  for (const [file, v] of Object.entries(versions)) {
    info(`  ${file}: ${v}${v !== version ? ` (expected ${version})` : ''}`);
  }
  return false;
}

function checkChangelogEntry() {
  sectionBreak();
  info('Checking CHANGELOG.md for current version...');

  const version = readPkgVersion();
  const changelogPath = join(ROOT_DIR, 'CHANGELOG.md');

  if (!existsSync(changelogPath)) {
    fail('CHANGELOG.md not found');
    return false;
  }

  const changelog = readFileSync(changelogPath, 'utf-8');
  // Look for version header (e.g., "## [6.7.87]" or "## 6.7.87" or "# 6.7.87")
  const versionPattern = new RegExp(`##\\s+\\[?${version.replace(/\./g, '\\.')}\\]?`, 'i');
  if (versionPattern.test(changelog)) {
    pass(`CHANGELOG.md has entry for version ${version}`);
    return true;
  }

  // Check if the version string appears at all
  if (changelog.includes(version)) {
    pass(`CHANGELOG.md mentions version ${version}`);
    return true;
  }

  warn(`CHANGELOG.md does not have a clear entry for version ${version}`);
  return true; // Warning only
}

function checkAgentsPaths() {
  sectionBreak();
  info('Checking AGENTS.md file paths...');

  const agentsPath = join(ROOT_DIR, 'AGENTS.md');
  if (!existsSync(agentsPath)) {
    warn('AGENTS.md not found');
    return true;
  }

  const content = readFileSync(agentsPath, 'utf-8');
  // Extract file paths from markdown links and code blocks
  const pathPattern = /(?:`|\[)([\w./-]+\.(?:ts|js|md|json|mjs|png))(?:\]|`)/g;
  const referencedPaths = [];
  let match;
  while ((match = pathPattern.exec(content)) !== null) {
    const p = match[1];
    if (p.startsWith('src/') || p.startsWith('dev-docs/') || p.startsWith('docs/') || p.startsWith('entrypoints/')) {
      referencedPaths.push(p);
    }
  }

  const missing = [];
  for (const p of referencedPaths) {
    if (!existsSync(join(ROOT_DIR, p))) {
      missing.push(p);
    }
  }

  if (missing.length > 0) {
    warn(`${missing.length} file path(s) in AGENTS.md may be stale:`);
    for (const p of missing) info(`  ${p}`);
  } else {
    pass('AGENTS.md file paths appear valid');
  }

  return true;
}

function main() {
  const results = [];

  results.push({ name: 'README Links', ok: checkReadmeLinks() });
  results.push({ name: 'Docs Files', ok: checkDocsFilesExist() });
  results.push({ name: 'Version Consistency', ok: checkVersionConsistency() });
  results.push({ name: 'CHANGELOG Entry', ok: checkChangelogEntry() });
  results.push({ name: 'AGENTS Paths', ok: checkAgentsPaths() });

  sectionBreak();
  const allPassed = summary();
  process.exit(allPassed ? 0 : 1);
}

main();
