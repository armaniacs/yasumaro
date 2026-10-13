import { describe, it, expect } from 'vitest';
import { readSettingsSnapshot } from '../settingsSnapshot.js';
import { isSettingsBlobAuthoritative } from '../settingsMigration.js';
import { InMemoryStoragePort } from '../storagePort.js';

/**
 * settingsSnapshot-authority-parity.test.ts (PBI 2026-09-28-30)
 *
 * readSettingsSnapshot mirrors isSettingsBlobAuthoritative without importing
 * its crypto-bound module graph. This matrix pins their agreement so a drift
 * fails loudly instead of silently forking the read path.
 */
describe('snapshot authority parity', () => {
  // A key present ONLY in scattered storage separates the branches
  // observably: authoritative reads ignore it (default wins),
  // non-authoritative reads fold it in.
  const states: Array<{ name: string; raw: unknown; foldsScattered: boolean }> = [
    { name: 'legacy boolean true', raw: true, foldsScattered: false },
    { name: 'completed v2', raw: { stage: 'completed', schemaVersion: 2 }, foldsScattered: false },
    { name: 'completed v3', raw: { stage: 'completed', schemaVersion: 3 }, foldsScattered: false },
    { name: 'in-progress', raw: { stage: 'migrating', schemaVersion: 2 }, foldsScattered: true },
    { name: 'old schema', raw: { stage: 'completed', schemaVersion: 1 }, foldsScattered: true },
    { name: 'absent', raw: undefined, foldsScattered: true },
    { name: 'null', raw: null, foldsScattered: true },
    { name: 'empty object', raw: {}, foldsScattered: true },
  ];

  it('agrees with the canonical predicate on every state', async () => {
    for (const { name, raw, foldsScattered } of states) {
      expect(isSettingsBlobAuthoritative(raw), `${name}: canonical`).toBe(!foldsScattered);
      // The key lives ONLY in scattered storage: authoritative reads ignore
      // it (undefined — callers fall back), non-authoritative reads fold it in.
      const port = new InMemoryStoragePort();
      await port.set({ settings: {}, min_scroll_depth: 77, settings_migrated: raw });
      const snapshot = await readSettingsSnapshot(port);
      expect(snapshot.min_scroll_depth, `${name}: snapshot`).toBe(foldsScattered ? 77 : undefined);
    }
  });

  it('reads an authoritative blob without touching scattered keys', async () => {
    const port = new InMemoryStoragePort();
    await port.set({
      settings: { min_scroll_depth: 80 },
      settings_migrated: { stage: 'completed', schemaVersion: 2 },
    });
    const snapshot = await readSettingsSnapshot(port);
    expect(snapshot.min_scroll_depth).toBe(80);
  });

  it('folds scattered keys under the blob when not authoritative', async () => {
    const port = new InMemoryStoragePort();
    await port.set({ settings: {}, min_scroll_depth: 77 });
    const snapshot = await readSettingsSnapshot(port);
    expect(snapshot.min_scroll_depth).toBe(77);
  });

  it('preserves absence (no defaults fill) and never writes', async () => {
    const port = new InMemoryStoragePort();
    const setCalls: unknown[][] = [];
    const origSet = port.set.bind(port);
    port.set = async (...args: unknown[]) => {
      setCalls.push(args);
      return origSet(...(args as [Record<string, unknown>]));
    };
    const snapshot = await readSettingsSnapshot(port);
    // Absent stays absent: callers own their fallbacks, and filling here
    // would turn "absent" into "present-but-default".
    expect('min_scroll_depth' in snapshot).toBe(false);
    expect(setCalls).toEqual([]);
  });
});
