/**
 * geturl-extraction-sync.test.ts
 *
 * Pins the getURL extraction rule across the two verification layers
 * (PBI 2026-10-13-06). The source layer (src/__tests__/manifest.test.ts,
 * build-free vitest suite) and the artifact layer
 * (scripts/release-checks/check-manifest.mjs, CI build gate) both derive
 * web_accessible_resources needs from the same heuristic: every static
 * `chrome.runtime.getURL('...')` literal in page-context code. The rule is
 * duplicated across two runtimes (vitest/TS and node/.mjs), so a change to
 * only one side (e.g. adding getURL(variable) support) would make the other
 * side's pass hide the gap. A rule change must land in both or this pin
 * fails — the ci-paths-filter pattern (pinning cross-file wiring in a test).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/** The two layers that must keep the same getURL extraction rule. */
const EXTRACTION_RULE_FILES = [
  // Source layer: build-free vitest suite (PBI 2026-10-12-03).
  join(process.cwd(), 'src', '__tests__', 'manifest.test.ts'),
  // Artifact layer: CI build gate (PBI 2026-10-12-03).
  join(process.cwd(), 'scripts', 'release-checks', 'check-manifest.mjs'),
];

/**
 * Pulls the getURL extraction regex literal out of a file's source. Both
 * layers declare it as `const getURLPattern = /getURL\(...\)/g;`; capture the
 * literal so the comparison sees the regex source only.
 */
function extractGetURLRule(source: string, file: string): string {
  const declared = source.match(/const getURLPattern = (\/getURL[^;]*\/g);/);
  if (declared === null) {
    throw new Error(
      `No getURL extraction rule found in ${file} — the rule moved. Update ` +
        'geturl-extraction-sync.test.ts to pin the new location (PBI 2026-10-13-06).',
    );
  }
  const rule = declared[1];
  if (rule === undefined) {
    throw new Error(
      `No getURL rule captured from ${file} — the declaration changed shape. Update ` +
        'geturl-extraction-sync.test.ts to pin the new shape (PBI 2026-10-13-06).',
    );
  }
  return rule;
}

describe('getURL extraction rule stays in sync across the two verification layers', () => {
  it('declares the same extraction rule in the source layer and the artifact gate', () => {
    const rules = EXTRACTION_RULE_FILES.map((file) =>
      extractGetURLRule(readFileSync(file, 'utf8'), file),
    );
    const [sourceLayer, artifactLayer] = rules;
    expect(sourceLayer).toBe(artifactLayer);
  });
});
