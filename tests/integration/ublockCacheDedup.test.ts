import { describe, it, expect, beforeEach } from 'vitest';
import { installTestSecretKek } from '../../src/utils/crypto/__tests__/secretKekHelper.js';
import { InMemoryStorageAdapter, SettingsRepository } from '../../src/utils/storage/SettingsRepository.js';
import { deriveUblockRulesFromSources } from '../../src/utils/derivedUblockRules.js';
import { rebuildRulesFromSources } from '../../src/dashboard/settings/ublockImport/rulesBuilder.js';
import { isUrlBlocked } from '../../src/utils/ublockMatcher.js';
import { STORAGE_QUOTA_BYTES } from '../../src/utils/limits.js';
import type { Source, UblockRules } from '../../src/utils/types.js';

// PBI 2026-11-06-01: the settings blob kept every domain string twice — once
// per Source in `ublock_sources` and once merged in `ublock_rules`
// (~9.4MB each in the reported profile). `ublock_rules` is derivable from
// `ublock_sources` via a pure function, so only one copy may persist.

const SOURCES_PER_FIXTURE = 4;
const DOMAINS_PER_SOURCE = 15000;

function buildLargeSources(): Source[] {
  const sources: Source[] = [];
  for (let s = 0; s < SOURCES_PER_FIXTURE; s++) {
    const blockDomains: string[] = [];
    // Overlap the tail of the previous source so the merged set dedupes.
    const start = s === 0 ? 0 : s * DOMAINS_PER_SOURCE - 3000;
    for (let i = start; i < s * DOMAINS_PER_SOURCE + DOMAINS_PER_SOURCE; i++) {
      blockDomains.push(`bulk${String(i).padStart(6, '0')}.example.net`);
    }
    const exceptionDomains = [`exc${s}.example.net`];
    sources.push({
      url: `https://lists.example.net/filter${s}.txt`,
      ruleCount: blockDomains.length + exceptionDomains.length,
      blockDomains,
      exceptionDomains,
      importedAt: 1700000000000 + s,
    });
  }
  return sources;
}

/** Legacy on-disk shape: sources plus the merged cache (the duplication). */
function buildLegacyRules(sources: Source[]): UblockRules {
  const merged = rebuildRulesFromSources(sources);
  return {
    blockDomains: merged.blockDomains,
    exceptionDomains: merged.exceptionDomains,
    metadata: merged.metadata,
  };
}

const PROBE_URLS = [
  'https://bulk000123.example.net/tracker.js',
  'https://bulk030000.example.net/pixel',
  'https://bulk059999.example.net/ads.js',
  'https://exc1.example.net/page',
  'https://never-listed.example.org/',
];

function verdicts(rules: UblockRules): boolean[] {
  return PROBE_URLS.map((url) => isUrlBlocked(url, rules));
}

async function repoWithBlob(settingsBlob: Record<string, unknown>): Promise<SettingsRepository> {
  const mem = new InMemoryStorageAdapter();
  await mem.set({ settings: settingsBlob, settings_migrated: true });
  return new SettingsRepository(mem as unknown as ConstructorParameters<typeof SettingsRepository>[0]);
}

describe('ublock cache dedup integration', () => {
  beforeEach(async () => {
    await installTestSecretKek();
  });

  it('persists a single copy of domains instead of sources-plus-merged-rules', async () => {
    const sources = buildLargeSources();
    const legacyRules = buildLegacyRules(sources);
    const duplicatedSize = JSON.stringify({ sources, rules: legacyRules }).length;

    const repo = await repoWithBlob({
      ublock_sources: sources,
      ublock_rules: legacyRules,
      ublock_format_enabled: true,
    });
    const settings = await repo.getAll();

    expect(settings.ublock_rules.blockDomains).toEqual([]);
    expect(settings.ublock_rules.exceptionDomains).toEqual([]);
    const singleCopySize = JSON.stringify({ sources: settings.ublock_sources, rules: settings.ublock_rules }).length;
    // One copy must remain: the normalized blob is roughly half the legacy one.
    expect(singleCopySize * 1.5).toBeLessThan(duplicatedSize);
    expect(singleCopySize).toBeLessThan(STORAGE_QUOTA_BYTES);
  });

  it('blocks identically with derived rules and the legacy merged cache', async () => {
    const sources = buildLargeSources();
    const legacyRules = buildLegacyRules(sources);
    const derived = deriveUblockRulesFromSources(sources);

    expect(verdicts(derived)).toEqual(verdicts(legacyRules));
    // The fixture really blocks something and really allows something.
    expect(verdicts(derived)).toContain(true);
    expect(verdicts(derived)).toContain(false);
  });

  it('round-trips an export payload that stays small and blocks the same', async () => {
    const sources = buildLargeSources();
    const legacyRules = buildLegacyRules(sources);
    const repo = await repoWithBlob({
      ublock_sources: sources,
      ublock_rules: legacyRules,
      ublock_format_enabled: true,
    });
    const stored = await repo.getAll();

    const exportPayload = {
      version: '1.1.0',
      exportedAt: new Date().toISOString(),
      settings: stored,
      apiKeyExcluded: true,
    };
    const exportJson = JSON.stringify(exportPayload);
    expect(exportJson.length).toBeLessThan(STORAGE_QUOTA_BYTES);
    // The export carries the single copy: sources hold the domains,
    // the derived cache travels empty.
    expect(exportPayload.settings.ublock_rules.blockDomains).toEqual([]);
    expect(exportPayload.settings.ublock_rules.exceptionDomains).toEqual([]);

    const imported = JSON.parse(exportJson) as { settings: Record<string, unknown> };
    const target = await repoWithBlob(imported.settings);
    const restored = await target.getAll();
    const restoredRules = deriveUblockRulesFromSources(restored.ublock_sources);

    expect(verdicts(restoredRules)).toEqual(verdicts(legacyRules));
  });

  it('round-trips the empty state without changes', async () => {
    const repo = await repoWithBlob({ ublock_sources: [], ublock_format_enabled: false });
    const settings = await repo.getAll();

    expect(settings.ublock_sources).toEqual([]);
    expect(settings.ublock_rules.blockDomains).toEqual([]);
    const derived = deriveUblockRulesFromSources(settings.ublock_sources);
    expect(verdicts(derived)).toEqual([false, false, false, false, false]);
  });
});
