// @vitest-environment jsdom
// Locale pin for statusInvalidUrl: the no-domain writer result still has a
// user-facing message in both locales (the wireWhitelistButton result branch).
// The historical statusAddPath button was removed by the 2026-10-31
// adjudication — path adds normalize to the URL's hostname, so its option was
// behaviorally identical to the domain button and its wording mislabeled the
// matching scope. The no-domain branch it drove stays as type-complete
// handling of WhitelistWriteResult and is pinned at runtime by
// statusPanel-whitelist-wire-golden.test.ts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const enMessages = JSON.parse(
  readFileSync(join(repoRoot, 'public', '_locales', 'en', 'messages.json'), 'utf-8'),
) as Record<string, { message: string }>;
const jaMessages = JSON.parse(
  readFileSync(join(repoRoot, 'public', '_locales', 'ja', 'messages.json'), 'utf-8'),
) as Record<string, { message: string }>;

function localeMessage(table: Record<string, { message: string }>, key: string): string {
  const entry = table[key];
  if (!entry) throw new Error(`missing locale key: ${key}`);
  return entry.message;
}

describe('statusPanel invalid URL locales', () => {
  it('registers statusInvalidUrl in both locales with non-empty copy', () => {
    expect(localeMessage(enMessages, 'statusInvalidUrl')).toBeTruthy();
    expect(localeMessage(jaMessages, 'statusInvalidUrl')).toBeTruthy();
  });
});
