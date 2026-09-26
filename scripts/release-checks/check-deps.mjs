#!/usr/bin/env node

/**
 * check-deps.mjs — Dependency & security verification.
 *
 * Verifies:
 * 1. `npm audit` — no critical or high vulnerabilities
 * 2. Major dependency versions are not severely outdated (warn-level)
 * 3. License compliance (reuses existing check-licenses.mjs)
 *
 * All three checks spawn npm (two of them hitting the registry), so they are
 * executed concurrently and only the reporting is serialised. The dependency
 * manifests fingerprint gates `npm outdated`: it can only change when a
 * dependency is republished, so the registry round-trip is cached per manifest
 * state instead of being paid on every run. Set RELEASE_CHECKS_NO_CACHE=1 to
 * skip the cache in both directions (fresh lookup, no write-back).
 *
 * Only a successful registry round-trip is ever cached or reported as clean: a
 * payload that npm could not fetch is a failed check, not an empty result.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');

const { header, pass, fail, warn, info, sectionBreak, summary } = await import('./utils/reporter.mjs');

const CRITICAL_PACKAGES = [
  'wxt',
  '@subframe7536/sqlite-wasm',
  'vitest',
  '@playwright/test',
  'typescript',
  'vite',
  'eslint',
  'wa-sqlite',
];

const OUTDATED_CACHE_PATH = join(ROOT_DIR, 'node_modules', '.cache', 'release-checks', 'outdated.json');
const OUTDATED_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BUFFER = 10 * 1024 * 1024;

/**
 * Runs an npm command that reports findings through its JSON stdout and a
 * non-zero exit code. npm still writes the payload to stdout in that case, so
 * the failure is unwrapped into a normal return.
 *
 * npm also writes a JSON *error* object to stdout when the registry is
 * unreachable or auth fails, and exits 1. That payload is returned here just
 * like a real one, so every caller must validate the shape before reading
 * findings from it — otherwise "the audit could not run" and "the audit found
 * nothing" become the same green result.
 */
function runNpmJson(args) {
  return execFileAsync('npm', args, {
    cwd: ROOT_DIR,
    encoding: 'utf-8',
    maxBuffer: MAX_BUFFER,
  }).then(
    ({ stdout }) => stdout,
    (error) => {
      if (typeof error.stdout === 'string' && error.stdout.trim()) return error.stdout;
      throw error;
    }
  );
}

/** Parses stdout, refusing anything that is not the JSON document we asked for. */
function parseNpmJson(raw, what) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${what} returned non-JSON output: ${e.message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${what} returned ${Array.isArray(parsed) ? 'an array' : typeof parsed}, not an object`);
  }
  return parsed;
}

function parseAudit(raw) {
  const parsed = parseNpmJson(raw, 'npm audit');
  // A real audit report always carries a format version. npm's error object
  // ({ error: { code: 'EAI_AGAIN', ... } }) does not, so its absence means the
  // scan never reached the registry — which must fail, not pass.
  if (parsed.auditReportVersion === undefined) {
    throw new Error(`npm audit did not return an audit report (${parsed.error?.code ?? parsed.message ?? 'no reason given'})`);
  }
  const vulnerabilities = parsed.vulnerabilities || {};
  const bySeverity = (severity) => Object.entries(vulnerabilities).filter(([, v]) => v.severity === severity);
  return { critical: bySeverity('critical'), high: bySeverity('high') };
}

function describeVulnerability([name, entry]) {
  const via = Array.isArray(entry.via) ? entry.via : [entry.via].filter(Boolean);
  const detail =
    via.map((v) => (typeof v === 'string' ? v : v.title || v.name)).find(Boolean) || entry.range || 'no details';
  return `  ${name}: ${entry.severity} — ${detail}`;
}

async function collectAudit() {
  try {
    return parseAudit(await runNpmJson(['audit', '--json']));
  } catch (e) {
    return { error: e.message, critical: [], high: [] };
  }
}

function reportAudit(result) {
  header('npm Audit');
  info('Running `npm audit`...');

  if (result.error) {
    fail(`npm audit failed unexpectedly: ${result.error}`);
    return;
  }

  if (result.critical.length > 0) {
    fail(`Found ${result.critical.length} critical vulnerability(ies)`);
    for (const entry of result.critical) info(describeVulnerability(entry));
    return;
  }

  if (result.high.length > 0) {
    fail(`Found ${result.high.length} high severity vulnerability(ies)`);
    for (const entry of result.high) info(describeVulnerability(entry));
    return;
  }

  pass('No critical or high vulnerabilities found');
}

function manifestFingerprint() {
  const hash = createHash('sha256');
  for (const file of ['package.json', 'package-lock.json']) {
    hash.update(readFileSync(join(ROOT_DIR, file)));
  }
  return hash.digest('hex');
}

function readOutdatedCache(fingerprint) {
  try {
    const cache = JSON.parse(readFileSync(OUTDATED_CACHE_PATH, 'utf-8'));
    if (cache.fingerprint !== fingerprint) return null;
    if (Date.now() - cache.fetchedAt > OUTDATED_CACHE_TTL_MS) return null;
    return cache;
  } catch {
    return null;
  }
}

function writeOutdatedCache(fingerprint, majorDrift) {
  try {
    mkdirSync(dirname(OUTDATED_CACHE_PATH), { recursive: true });
    writeFileSync(OUTDATED_CACHE_PATH, JSON.stringify({ fingerprint, fetchedAt: Date.now(), majorDrift }, null, 2));
  } catch {
    // A missed cache on the next run is not worth failing a release gate over.
  }
}

function findMajorDrift(outdated) {
  return Object.entries(outdated)
    .filter(([name]) => CRITICAL_PACKAGES.includes(name))
    .map(([name, entry]) => ({ name, current: entry.current, wanted: entry.wanted }))
    .filter(({ current, wanted }) => String(current).split('.')[0] !== String(wanted).split('.')[0]);
}

/**
 * `npm outdated --json` lists only the packages that HAVE a newer release, so
 * an empty object is the healthy "nothing to do" answer. npm's error object is
 * also an empty-shaped object, which is why the registry error has to be
 * rejected explicitly before the result is allowed anywhere near the cache.
 */
function parseOutdated(raw) {
  const parsed = parseNpmJson(raw, 'npm outdated');
  if (parsed.error !== undefined || parsed.message !== undefined) {
    throw new Error(`npm outdated did not reach the registry (${parsed.error?.code ?? parsed.message})`);
  }
  return parsed;
}

async function collectOutdatedDeps() {
  let fingerprint = null;
  try {
    fingerprint = manifestFingerprint();
  } catch {
    // Without a readable manifest there is nothing to key the cache on; fall
    // back to a live lookup.
  }

  const cacheEnabled = !process.env.RELEASE_CHECKS_NO_CACHE;
  const cached = fingerprint && cacheEnabled ? readOutdatedCache(fingerprint) : null;
  if (cached) return { majorDrift: cached.majorDrift, fromCache: true };

  try {
    const majorDrift = findMajorDrift(parseOutdated(await runNpmJson(['outdated', '--json'])));
    // Only a lookup that actually reached the registry may be cached —
    // otherwise one network blip would pin a false "no drift" for 24h.
    if (fingerprint && cacheEnabled) writeOutdatedCache(fingerprint, majorDrift);
    return { majorDrift, fromCache: false };
  } catch (e) {
    // This check is warn-only, so an unreachable registry is not fatal.
    return { majorDrift: null, fromCache: false, error: e.message };
  }
}

function reportOutdatedDeps(result) {
  sectionBreak();

  if (result.error) {
    warn(`Could not query \`npm outdated\` (no network or npm error): ${result.error}`);
    return;
  }

  if (result.fromCache) {
    info('Dependency manifests unchanged since the last lookup — reusing cached `npm outdated` result');
  } else {
    info('Checking for outdated major dependencies...');
  }

  if (result.majorDrift.length > 0) {
    warn(`${result.majorDrift.length} critical package(s) have major updates available:`);
    for (const { name, current, wanted } of result.majorDrift) {
      info(`  ${name}: current=${current}, wanted=${wanted}`);
    }
    return;
  }

  pass('No major version drift on critical dependencies');
}

async function collectLicenses() {
  try {
    const { stdout } = await execFileAsync('node', ['scripts/check-licenses.mjs'], {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
      maxBuffer: MAX_BUFFER,
    });
    return { ok: true, message: stdout.trim() };
  } catch (e) {
    return { ok: false, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') };
  }
}

function reportLicenses(result) {
  sectionBreak();
  info('Running license compliance check...');

  if (!result.ok) {
    fail('License check failed');
    if (result.stdout) info(result.stdout.slice(-300));
    if (result.stderr) info(result.stderr.slice(-300));
    return;
  }

  pass(result.message);
}

/**
 * Compares what the lockfile promises against what is actually on disk.
 *
 * `npm audit` and `npm outdated` both read manifests, so they are faithful to
 * the lockfile and blind to `node_modules`. `npm install --package-lock-only`
 * updates the lock without touching the tree, so a tree left over from an
 * earlier install keeps running a version the lock has already moved past while
 * every manifest-derived check reports the new one. Observed during the 6.9.26
 * release prep: `node_modules/adm-zip` at 0.6.0 while the lock, the `overrides`
 * entry and the devDependency all said 0.6.1, and the gate printed "No critical
 * or high vulnerabilities found".
 *
 * Each package's own `package.json` is read rather than
 * `node_modules/.package-lock.json`, because npm rewrites that file to match
 * intent — comparing it against the lock is metadata against metadata and
 * reproduces the same blind spot.
 */
function collectInstallDrift() {
  const drift = [];
  let locked;

  try {
    locked = JSON.parse(readFileSync(join(ROOT_DIR, 'package-lock.json'), 'utf-8')).packages ?? {};
  } catch (e) {
    return { skipped: true, error: e.message, drift };
  }

  let inspected = 0;
  let missing = 0;
  for (const [location, expected] of Object.entries(locked)) {
    if (!location.startsWith('node_modules/') || !expected.version) continue;
    try {
      const manifest = JSON.parse(readFileSync(join(ROOT_DIR, location, 'package.json'), 'utf-8'));
      inspected += 1;
      if (manifest.version !== expected.version) {
        drift.push({ location, expected: expected.version, actual: manifest.version });
      }
    } catch {
      // Not installed (optional / platform-specific dep). Not drift.
      missing += 1;
    }
  }

  return { skipped: false, drift, inspected, missing };
}

function reportInstallDrift(result) {
  sectionBreak();
  header('Installed tree vs lockfile');

  if (result.skipped) {
    info(`Skipped: ${result.error} — run \`npm ci\` first if you want this verified`);
    return;
  }

  const scope = `${result.inspected} package(s) inspected, ${result.missing} not installed`;
  if (result.drift.length === 0) {
    pass(`Installed packages match the lockfile (${scope})`);
    return;
  }

  fail(`${result.drift.length} installed package(s) differ from the lockfile (${scope})`);
  for (const entry of result.drift.slice(0, 20)) {
    info(`${entry.location}: installed ${entry.actual}, lockfile says ${entry.expected}`);
  }
  if (result.drift.length > 20) info(`… and ${result.drift.length - 20} more`);
  info('Run `npm ci` so the tree matches the lock. A manifest-only bump leaves the old version running.');
}

async function main() {
  const [audit, outdated, licenses] = await Promise.all([
    collectAudit(),
    collectOutdatedDeps(),
    collectLicenses(),
  ]);

  reportAudit(audit);
  reportOutdatedDeps(outdated);
  reportLicenses(licenses);
  reportInstallDrift(collectInstallDrift());

  sectionBreak();
  const allPassed = summary();
  process.exit(allPassed ? 0 : 1);
}

try {
  await main();
} catch (e) {
  // A release gate that dies on a stack trace hides the actual problem.
  fail(`Dependency check could not complete: ${e.message}`);
  process.exit(1);
}
