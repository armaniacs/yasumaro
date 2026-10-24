#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
const out = JSON.stringify({ version: pkg.version }, null, 2) + '\n';
writeFileSync(new URL('../docs/version.json', import.meta.url), out);
console.log(`synced docs/version.json -> ${pkg.version}`);

// package-lock.json carries the same version twice (top-level "version" and
// packages[""].version). A package.json-only bump leaves the lock stale and
// trips versionConsistency.test.ts (seen at 6.9.58 and again at 6.9.59), so the
// SSOT sync covers it too. Only those two lines are touched — no full
// lockfile rewrite — to keep the diff minimal.
const lockUrl = new URL('../package-lock.json', import.meta.url);
const lock = readFileSync(lockUrl, 'utf-8');
const synced = lock
  .replace(/"version": "[^"]*"/, `"version": "${pkg.version}"`)
  .replace(/(""\s*:\s*\{\s*"name": "[^"]*",\s*)"version": "[^"]*"/, `$1"version": "${pkg.version}"`);
if (synced !== lock) {
  writeFileSync(lockUrl, synced);
  console.log(`synced package-lock.json -> ${pkg.version}`);
} else {
  console.log('package-lock.json already in sync');
}
