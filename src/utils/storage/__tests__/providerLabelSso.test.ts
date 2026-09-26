/**
 * providerLabelSso.test.ts
 * UI display names must come from the neutral table
 * (src/utils/storage/providerAllowlist), never from the background catalog.
 *
 * WHY this needs a test of its own: at the call site,
 * `tryResolveCatalogEntry(provider)?.label` reads like a pure table lookup, so
 * importing background/ai/providerCatalog from a UI file looks free. It is not —
 * that module statically imports the three provider strategies, so a display-only
 * dependency turns into a background dependency edge in the UI bundle.
 * local/utils-layer-boundary only inspects src/utils, so nothing enforces this
 * edge mechanically. The scope is deliberately narrow: the general
 * cross-layer rule (popup → background) is a separate PBI.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const NEUTRAL_TABLE = 'src/utils/storage/providerAllowlist.ts';
const UI_LABEL_CONSUMERS = [
  'src/popup/errorUtils.ts',
  'src/dashboard/aiTestResultView.ts',
  'src/dashboard/settings/customPromptManager.ts',
];

/** Value imports only: `import type` is erased at compile time. */
function staticImports(file: string): string[] {
  const source = readFileSync(join(REPO_ROOT, file), 'utf8');
  return [...source.matchAll(/^\s*import\s+(?!type\s)[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]!);
}

describe('provider label SSOT boundary', () => {
  for (const file of UI_LABEL_CONSUMERS) {
    it(`${file} resolves labels from the neutral table, not the background catalog`, () => {
      const imports = staticImports(file);
      expect(imports.filter((specifier) => /background\/ai\/providerCatalog/.test(specifier))).toEqual([]);
      expect(imports.filter((specifier) => /storage\/providerAllowlist/.test(specifier))).toHaveLength(1);
    });
  }

  it('the neutral table stays a storage/types-only module', () => {
    // Strategy construction and storage wiring must never move down here: a
    // background import in this file would invert the layer direction again.
    expect([...new Set(staticImports(NEUTRAL_TABLE))]).toEqual(['./types.js']);
  });
});
