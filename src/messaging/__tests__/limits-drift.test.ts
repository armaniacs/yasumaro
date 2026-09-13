import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Cap-registry drift guard (PBI 2026-09-11-08).
 *
 * Caps live in src/messaging/limits.ts. A numeric size/time cap re-declared
 * outside it is the exact failure mode this guard prevents: the definition
 * sites previously drifted (MAX_QUERY_LIMIT twice, the 8MB archive chunk
 * twice, log-forward caps greppable from nowhere).
 *
 * The guard matches VALUE-ASSIGNMENT patterns only (`= 64 * 1024` etc.), so
 * doc comments and comparisons may mention the numbers freely.
 */

/** cap name → numeric literal (as written in limits.ts) */
const CAPS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'MAX_LOG_FORWARD_MESSAGE_CHARS', pattern: /=\s*64\s*\*\s*1024\b/ },
  { name: 'MAX_LOG_FORWARD_SERIALIZED_CHARS', pattern: /=\s*256\s*\*\s*1024\b/ },
  { name: 'MAX_RECORD_SIZE', pattern: /=\s*64\s*\*\s*1024\b/ },
  { name: 'MAX_PII_INPUT_SIZE', pattern: /=\s*64\s*\*\s*1024\b/ },
  { name: 'MAX_TOKENS_PER_CALL', pattern: /=\s*10_000_000\b/ },
  { name: 'MAX_ENVELOPE_CIPHERTEXT_LENGTH', pattern: /=\s*64\s*\*\s*1024\s*\*\s*1024\b/ },
  { name: 'MAX_ERROR_BODY_SIZE', pattern: /=\s*1024\s*\*\s*1024\b/ },
  { name: 'MAX_QUERY_LIMIT', pattern: /=\s*100000\b|=\s*100_000\b/ },
  // 10 MiB family (round 6, PBI 2026-09-11-08)
  { name: '10MB family', pattern: /=\s*10\s*\*\s*1024\s*\*\s*1024\b/ },
];

/** Files allowed to carry their own cap literals (different concern, same value). */
const EXEMPT = new Set([
  'src/messaging/limits.ts',
  // ublockParser's 10MB-ish locals are its own parse-input policy.
  'src/utils/ublockParser/index.ts',
  // Byte-formatting helpers (`const MB = 1024 * 1024`) — display formatting,
  // not an accept/reject bound.
  'src/dashboard/cleansingStatsView.ts',
  'src/dashboard/panels/asyncData/sqliteHistoryPanelView.ts',
  // PBI 2026-09-12-21: the byte-formatting helper moved out of
  // sqliteHistoryPanelView into its own module — same display-policy concern.
  'src/dashboard/panels/asyncData/entryByteDelta.ts',
  // privacy.ts fetches the bundled PRIVACY.md; the 1MB guard is a build-artifact
  // sanity check, not a message-pipeline cap.
  'src/privacy/privacy.ts',
]);

describe('cap registry drift guard (PBI 2026-09-11-08)', () => {
  it('cap values are assigned only in limits.ts (exempt list aside)', async () => {
    const root = join(__dirname, '..', '..', '..');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === '__tests__' || name === 'node_modules' || name === 'dist' || name === 'testDir') continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
        const rel = relative(root, full).replaceAll('\\', '/');
        if (EXEMPT.has(rel)) continue;
        const content = readFileSync(full, 'utf-8');
        for (const cap of CAPS) {
          if (cap.pattern.test(content)) offenders.push(`${rel}: ${cap.name}`);
        }
      }
    };
    walk(join(root, 'src'));

    expect(offenders).toEqual([]);
  });

  it('limits.ts actually defines every absorbed cap', async () => {
    const limits = readFileSync(join(__dirname, '..', '..', '..', 'src', 'messaging', 'limits.ts'), 'utf-8');
    for (const name of [
      'MAX_QUERY_LIMIT', 'MAX_LOG_FORWARD_MESSAGE_CHARS', 'MAX_LOG_FORWARD_DETAILS_KEYS',
      'MAX_LOG_FORWARD_SERIALIZED_CHARS', 'MAX_RECORD_SIZE', 'MAX_PII_INPUT_SIZE',
      'MAX_PII_OUTPUT_SIZE', 'MAX_TOKENS_PER_CALL', 'MAX_ENVELOPE_CIPHERTEXT_LENGTH',
      'MAX_ERROR_BODY_SIZE', 'MAX_FILTER_LIST_SIZE', 'MAX_BODY_SIZE',
      'DEFAULT_IMPORT_SIZE_CAP_BYTES', 'MAX_ENVELOPE_BASE64_LENGTH',
      'MAX_AI_HTTP_RESPONSE_BYTES',
    ]) {
      expect(limits).toContain(`export const ${name}`);
    }
  });
});
