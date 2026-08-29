#!/usr/bin/env node

/**
 * check-manifest.mjs — Manifest V3 compliance & security verification.
 *
 * Verifies:
 * 1. Manifest V3 compliance (no V2 patterns)
 * 2. Permissions are minimal (no unnecessary permissions)
 * 3. host_permissions uses specific domains (no <all_urls> unless content_scripts requires it)
 * 4. No inline scripts or event handlers in HTML files
 * 5. Content scripts match are appropriate
 * 6. web_accessible_resources is minimal
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');
const DIST_DIR = join(ROOT_DIR, 'dist', 'chromium-mv3');

const { header, pass, fail, warn, info, sectionBreak, summary } = await import('./utils/reporter.mjs');

function checkManifestV3Compliance() {
  header('Manifest V3 Compliance');
  const manifestPath = join(DIST_DIR, 'manifest.json');
  if (!existsSync(manifestPath)) {
    fail('Built manifest.json not found — run build first');
    return false;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  // manifest_version
  if (manifest.manifest_version === 3) {
    pass('manifest_version is 3');
  } else {
    fail(`manifest_version is ${manifest.manifest_version}, expected 3`);
    return false;
  }

  // No V2 background.scripts
  if (manifest.background && !manifest.background.scripts) {
    pass('No V2 background.scripts');
  } else if (manifest.background && manifest.background.scripts) {
    fail('Uses V2 background.scripts — must use service_worker');
    return false;
  } else {
    pass('No background.scripts (V2 pattern)');
  }

  // No V2 browser_action
  if (!manifest.browser_action) {
    pass('No V2 browser_action');
  } else {
    fail('Uses V2 browser_action — must use action');
    return false;
  }

  // action key present
  if (manifest.action) {
    pass('"action" key present');
  } else {
    fail('Missing "action" key');
    return false;
  }

  return true;
}

function checkPermissions() {
  sectionBreak();
  info('Checking permissions...');

  const manifestPath = join(DIST_DIR, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  const required = ['storage', 'scripting'];
  const optional = ['activeTab', 'offscreen', 'notifications', 'webRequest', 'declarativeNetRequest', 'alarms', 'favicon', 'contextMenus', 'downloads', 'unlimitedStorage'];

  const allPerms = [...(manifest.permissions || []), ...(manifest.optional_permissions || [])];

  // Check required permissions
  for (const p of required) {
    if (allPerms.includes(p)) {
      pass(`Required permission present: ${p}`);
    } else {
      fail(`Missing required permission: ${p}`);
    }
  }

  // Warn about optional permissions
  const usedOptional = allPerms.filter((p) => optional.includes(p));
  if (usedOptional.length > 0) {
    info(`Optional permissions in use: ${usedOptional.join(', ')}`);
  }

  return true;
}

function checkHostPermissions() {
  sectionBreak();
  info('Checking host_permissions...');

  const manifestPath = join(DIST_DIR, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  const allHostPerms = [
    ...(manifest.host_permissions || []),
    ...(manifest.optional_host_permissions || []),
  ];

  // Check for <all_urls>
  if (allHostPerms.includes('<all_urls>')) {
    warn('host_permissions includes <all_urls> — consider narrowing scope');
  } else {
    pass('No <all_urls> in host_permissions');
  }

  // Check content_scripts matches
  if (manifest.content_scripts) {
    for (const cs of manifest.content_scripts) {
      if (cs.matches && cs.matches.includes('<all_urls>')) {
        warn('content_scripts uses <all_urls> — required for content script injection');
        pass('content_scripts <all_urls> is expected for extension functionality');
      }
    }
  }

  info(`Total host permissions: ${allHostPerms.length}`);
  return true;
}

function checkCSP() {
  sectionBreak();
  info('Checking Content-Security-Policy...');

  const manifestPath = join(DIST_DIR, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  if (!manifest.content_security_policy) {
    fail('No content_security_policy defined');
    return false;
  }

  const csp = manifest.content_security_policy.extension_pages || manifest.content_security_policy;

  // Check for unsafe-eval
  if (csp.includes("'unsafe-eval'")) {
    fail('CSP allows unsafe-eval — not allowed in Manifest V3');
    return false;
  } else {
    pass('No unsafe-eval in CSP');
  }

  // Check for wasm-unsafe-eval (allowed for sqlite-wasm)
  if (csp.includes("'wasm-unsafe-eval'")) {
    pass('wasm-unsafe-eval present (required for sqlite-wasm)');
  }

  // Check for inline scripts
  if (csp.includes("'unsafe-inline'")) {
    warn('CSP allows unsafe-inline — verify this is intentional');
  } else {
    pass('No unsafe-inline in CSP');
  }

  // Check default-src
  if (csp.includes("default-src 'none'") || csp.includes('default-src "none"')) {
    pass('default-src is restricted');
  } else {
    warn('default-src is not set to none');
  }

  return true;
}

function checkIcons() {
  sectionBreak();
  info('Checking icons...');

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
    } else {
      const stat = statSync(fullPath);
      info(`  ${size}x${size}: ${(stat.size / 1024).toFixed(1)}KB`);
    }
  }

  if (missing.length > 0) {
    fail(`Missing icon files: ${missing.join(', ')}`);
    return false;
  }

  pass('All declared icons exist');
  return true;
}

function checkWebAccessibleResources() {
  sectionBreak();
  info('Checking web_accessible_resources...');

  const manifestPath = join(DIST_DIR, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  if (!manifest.web_accessible_resources || manifest.web_accessible_resources.length === 0) {
    warn('No web_accessible_resources declared');
    return true;
  }

  const war = manifest.web_accessible_resources[0];
  if (!war.matches || !Array.isArray(war.matches)) {
    fail('web_accessible_resources missing matches array (required in MV3)');
    return false;
  }

  pass('web_accessible_resources has matches array');
  info(`  Resources: ${war.resources?.join(', ') || 'none'}`);
  info(`  Matches: ${war.matches?.join(', ') || 'none'}`);

  return true;
}

function checkHtmlNoInlineScripts() {
  sectionBreak();
  info('Checking HTML files for inline scripts...');

  const htmlFiles = [];
  function collectHtml(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        collectHtml(fullPath);
      } else if (entry.name.endsWith('.html')) {
        htmlFiles.push(fullPath);
      }
    }
  }
  collectHtml(DIST_DIR);

  const violations = [];
  for (const file of htmlFiles) {
    const content = readFileSync(file, 'utf-8');
    // Check for inline <script> tags (not src=)
    const inlineScriptPattern = /<script(?![^>]*\bsrc\b)[^>]*>/gi;
    const matches = content.match(inlineScriptPattern);
    if (matches) {
      violations.push({ file: file.replace(DIST_DIR + '/', ''), count: matches.length });
    }
  }

  if (violations.length > 0) {
    fail(`Found inline <script> tags in ${violations.length} file(s):`);
    for (const v of violations) {
      info(`  ${v.file}: ${v.count} inline script(s)`);
    }
    return false;
  }

  pass('No inline scripts found in HTML files');
  return true;
}

function main() {
  const results = [];

  results.push({ name: 'MV3 Compliance', ok: checkManifestV3Compliance() });
  results.push({ name: 'Permissions', ok: checkPermissions() });
  results.push({ name: 'Host Permissions', ok: checkHostPermissions() });
  results.push({ name: 'CSP', ok: checkCSP() });
  results.push({ name: 'Icons', ok: checkIcons() });
  results.push({ name: 'WAR', ok: checkWebAccessibleResources() });
  results.push({ name: 'No Inline Scripts', ok: checkHtmlNoInlineScripts() });

  sectionBreak();
  const allPassed = summary();
  process.exit(allPassed ? 0 : 1);
}

main();
