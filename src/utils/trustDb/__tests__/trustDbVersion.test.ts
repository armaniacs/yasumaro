import { describe, test, expect, vi } from 'vitest';
import { TrustDbVersion, DB_VERSION } from '../trustDbVersion.js';
import type { TrustDatabase } from '../trustDbSchema.js';

function makeDatabase(overrides: Partial<TrustDatabase> = {}): TrustDatabase {
  return {
    version: '0.9.0',
    lastUpdated: new Date().toISOString(),
    tranco: { tier: 'top10k', domains: [], count: 0, sizeBytes: 0 },
    jpAnchor: { tlds: [], userTlds: [] },
    sensitive: { presets: { finance: [], gaming: [], sns: [] }, userBlacklist: [], whitelist: [] },
    bloomFilter: { data: '', hashCount: 1, bitCount: 1, expectedDomainCount: 0, hash: '' },
    ...overrides
  } as TrustDatabase;
}

describe('TrustDbVersion', () => {
  test('getVersion returns the current schema version', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const version = new TrustDbVersion({ save });
    expect(version.getVersion()).toBe(DB_VERSION);
    expect(DB_VERSION).toBe('1.0.0');
  });

  test('compareVersions delegates to the domainValidation implementation', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const version = new TrustDbVersion({ save });
    expect(version.compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(version.compareVersions('0.9.0', '1.0.0')).toBeLessThan(0);
    expect(version.compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
  });

  test('migrateDatabase updates an old version to latest and saves twice', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const version = new TrustDbVersion({ save });
    const db = makeDatabase({ version: '0.0.0' });

    await version.migrateDatabase(db);

    expect(db.version).toBe(DB_VERSION);
    expect(save).toHaveBeenCalledTimes(2);
  });

  test('migrateDatabase does nothing for the same version', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const version = new TrustDbVersion({ save });
    const db = makeDatabase({ version: DB_VERSION });

    await version.migrateDatabase(db);

    expect(save).not.toHaveBeenCalled();
  });

  test('applyMigrations fills missing fields with defaults', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const version = new TrustDbVersion({ save });
    const db = { version: '0.0.0', lastUpdated: new Date().toISOString() } as TrustDatabase;

    await version.applyMigrations('0.0.0', DB_VERSION, db);

    expect(db.tranco).toBeDefined();
    expect(db.jpAnchor).toBeDefined();
    expect(db.sensitive).toBeDefined();
    expect(db.sensitive.presets.finance.length).toBeGreaterThan(0);
  });
});
