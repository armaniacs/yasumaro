import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Collect production .ts files: skip test doubles (__tests__ dirs, *.test.ts,
 * *.spec.ts) and the e2e harness (testDir lives outside src/ anyway).
 */
function collectProdFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue;
      collectProdFiles(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * A "sender" constructs a message object with a `type:` key carrying the
 * literal. The key and literal may sit on different lines of a multi-line
 * object literal (as diagnosticsActions once did), so the pattern runs over
 * the whole file content. Type declarations (`type: 'X';`) and comparisons
 * (`type === 'X'`) never match: only `,`/`}` may follow the literal.
 */
function senderFiles(literal: string): string[] {
  const pattern = new RegExp(`type\\s*:\\s*'${literal}'\\s*[,}]`);
  return collectProdFiles(SRC_ROOT).filter((file) => pattern.test(readFileSync(file, 'utf-8')))
    .map((file) => file.split(SRC_ROOT + sep)[1].split(sep).join('/'))
    .sort();
}

describe('dashboard sender unification (PBI 11) — grep guard', () => {
  it('DASHBOARD_SQLITE is sent only from messaging/dashboardGateway.ts', () => {
    expect(senderFiles('DASHBOARD_SQLITE')).toEqual(['messaging/dashboardGateway.ts']);
  });

  it('TEST_AI and TEST_OBSIDIAN are sent only from connectionTests helpers', () => {
    expect(senderFiles('TEST_AI')).toEqual(['dashboard/generalSettings/connectionTests.ts']);
    expect(senderFiles('TEST_OBSIDIAN')).toEqual(['dashboard/generalSettings/connectionTests.ts']);
  });
});
