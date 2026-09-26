import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Byte-format SSOT guard (PBI 2026-09-25-07).
 *
 * The dashboard carried three byte-formatting definitions with two policies,
 * so the same byte count rendered differently per screen. This guard fails if
 * a second definition reappears in production code — the display policy is
 * owned by `src/dashboard/byteFormat.ts` alone.
 *
 * It is NOT a message-size cap guard: `limits-drift.test.ts` owns that
 * concern and its allowlist must not carry byte-formatting files.
 */

const SSOT = 'src/dashboard/byteFormat.ts';

const DEFINITION_PATTERNS = [
  /function\s+formatBytes\b/,
  /const\s+formatBytes\b/,
  /formatBytes\s*:\s*function\b/,
];

describe('byte-format SSOT guard (PBI 2026-09-25-07)', () => {
  it('only src/dashboard/byteFormat.ts defines the byte formatter', () => {
    const root = join(__dirname, '..', '..', '..');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === '__tests__' || name === 'node_modules' || name === 'dist' || name === 'graphify-out') continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
        const rel = relative(root, full).replaceAll('\\', '/');
        if (rel === SSOT) continue;
        const content = readFileSync(full, 'utf-8');
        for (const pattern of DEFINITION_PATTERNS) {
          if (pattern.test(content)) offenders.push(`${rel}: ${pattern.source}`);
        }
      }
    };
    walk(join(root, 'src'));

    expect(offenders).toEqual([]);
  });

  it('the SSOT holds exactly one definition and stays a pure module', () => {
    const root = join(__dirname, '..', '..', '..');
    const source = readFileSync(join(root, ...SSOT.split('/')), 'utf-8');

    expect(DEFINITION_PATTERNS.filter((p) => p.test(source))).toHaveLength(1);
    // Layer discipline: a pure formatter takes no import and no chrome API,
    // so it can be called from any dashboard view and panel alike.
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\bchrome\./);
  });
});
