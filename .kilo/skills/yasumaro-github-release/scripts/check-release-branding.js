#!/usr/bin/env node
/**
 * Check .github/workflows/release.yml for old/incorrect brand and repo references.
 * Exits with non-zero code if any forbidden strings are found.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WORKFLOW_PATH = resolve(__dirname, '../../..', '.github', 'workflows', 'release.yml');

const FORBIDDEN = [
  { pattern: /Obsidian Weave/g, replacement: 'Yasumaro' },
  { pattern: /armaniacs\/obsidian-weave/g, replacement: 'armaniacs/Yasumaro' },
];

function main() {
  let content;
  try {
    content = readFileSync(WORKFLOW_PATH, 'utf-8');
  } catch (err) {
    console.error(`Failed to read ${WORKFLOW_PATH}: ${err.message}`);
    process.exit(2);
  }

  let found = false;
  for (const { pattern, replacement } of FORBIDDEN) {
    const matches = content.match(pattern);
    if (matches) {
      found = true;
      console.error(`ERROR: Found forbidden reference "${matches[0]}" in ${WORKFLOW_PATH}`);
      console.error(`       Replace with "${replacement}".`);
    }
  }

  if (found) {
    process.exit(1);
  }

  console.log(`OK: No old brand or repo references found in ${WORKFLOW_PATH}`);
}

main();
