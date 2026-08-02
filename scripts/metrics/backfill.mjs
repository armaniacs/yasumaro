#!/usr/bin/env node

/**
 * One-off backfill: records historical metrics for the first tag of each
 * minor release series, from v2.0.0 through v6.7.2.
 *
 * Usage: node scripts/metrics/backfill.mjs
 */

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPDATE_HISTORY_SCRIPT = join(__dirname, 'updateHistory.mjs');

export const MILESTONE_TAGS = [
  'v2.0.0',
  'v2.1.0',
  'v2.2.0',
  'v2.3.0',
  'v3.0.0',
  'v4.0.0',
  'v4.1',
  'v4.2.0',
  'v5.0.0',
  'v5.1.0',
  'v5.2.0',
  'v6.0.1',
  'v6.1.2',
  'v6.3.0',
  'v6.4.0',
  'v6.5.2',
  'v6.6.0',
  'v6.7.2',
];

function main() {
  const failures = [];
  for (const tag of MILESTONE_TAGS) {
    console.log(`Recording metrics for ${tag}...`);
    try {
      execFileSync('node', [UPDATE_HISTORY_SCRIPT, tag], { stdio: 'inherit' });
    } catch (error) {
      console.error(`Failed to record metrics for ${tag}: ${error.message}`);
      failures.push(tag);
    }
  }

  if (failures.length > 0) {
    console.error(`Backfill completed with failures: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('Backfill completed successfully.');
}

main();
