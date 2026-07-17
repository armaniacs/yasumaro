#!/usr/bin/env node
/**
 * lint-adr-links.mjs
 *
 * Verifies that every file path listed in an ADR's `## Implements` section
 * actually exists in the repository. Exits with 1 if any path is missing.
 *
 * Usage:
 *   node scripts/lint-adr-links.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ADR_DIR = join(ROOT, 'dev-docs', 'ADR');

const files = (await readdir(ADR_DIR))
  .filter(f => f.endsWith('.md') && f !== 'README.md')
  .sort();

let errors = 0;

for (const file of files) {
  const filepath = join(ADR_DIR, file);
  const content = readFileSync(filepath, 'utf-8');

  const implementsMatch = content.match(/^## Implements\n+((?:- `[^`]+`[^\n]*\n?)+)/m);
  if (!implementsMatch) continue;

  const block = implementsMatch[1];
  const paths = [...block.matchAll(/- `([^`]+)`/g)].map(m => m[1]);

  for (const relPath of paths) {
    // Skip deprecated/deleted references marked with strikethrough
    if (relPath.startsWith('~~')) continue;

    const fullPath = join(ROOT, relPath);
    if (!existsSync(fullPath)) {
      console.error(`[ADR:${file}] MISSING: ${relPath}`);
      errors++;
    }
  }
}

if (errors > 0) {
  console.error(`\n${errors} missing file reference(s) found.`);
  process.exit(1);
}

console.log(`Checked ${files.length} ADRs — all implements references valid.`);
