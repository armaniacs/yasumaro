import { describe, it, expect, beforeEach } from 'vitest';
import { SettingsRepository, InMemoryStorageAdapter } from '../SettingsRepository.js';
import { StorageKeys } from '../types.js';

/**
 * PBI 2026-09-17-17 — settings writes are delta-based.
 *
 * The repository write path merges the caller's delta over the FRESH stored
 * blob under the write lock. A caller holding a stale snapshot (panel
 * lifetime) must not revert unrelated keys a concurrent writer changed.
 */
describe('SettingsRepository — delta write contract', () => {
  let adapter: InMemoryStorageAdapter;
  let repo: SettingsRepository;

  const KEY_A = StorageKeys.OBSIDIAN_HOST;
  const KEY_B = StorageKeys.OBSIDIAN_PORT;

  beforeEach(() => {
    adapter = new InMemoryStorageAdapter();
    repo = new SettingsRepository(adapter);
  });

  /** Simulate a concurrent writer that bypasses this repo instance (another
   *  context wrote to storage directly, so no onChanged fired here and the
   *  repo cache went stale). */
  async function concurrentWriterChangesKeyA(): Promise<void> {
    const raw = await adapter.get(['settings']);
    const blob = (raw['settings'] as Record<string, unknown>) ?? {};
    await adapter.set({
      settings: { ...blob, [KEY_A]: 'changed-by-other' } as Record<string, unknown>,
    });
  }

  it('set writes only its key — a concurrent writer’s change to another key survives', async () => {
    await repo.setAll({ [KEY_A]: 'old', [KEY_B]: '27124' });
    await repo.getAll(); // populate the repo cache (now stale after the direct write)

    await concurrentWriterChangesKeyA();

    await repo.set(KEY_B, '27125');

    expect(await repo.get(KEY_A)).toBe('changed-by-other');
    expect(await repo.get(KEY_B)).toBe('27125');
  });

  it('setAll treats the payload as a delta — unspecified keys keep their stored values', async () => {
    await repo.setAll({ [KEY_A]: 'old', [KEY_B]: '27124' });
    await repo.getAll();

    await concurrentWriterChangesKeyA();

    await repo.setAll({ [KEY_B]: '27125' });

    expect(await repo.get(KEY_A)).toBe('changed-by-other');
    expect(await repo.get(KEY_B)).toBe('27125');
  });

  it('a stale full snapshot passed to setAll DOES overwrite the concurrent change (caller contract)', async () => {
    // Documenting the seam boundary: setAll writes every key it is given.
    // Callers must pass deltas (panels do since PBI 2026-09-17-17); passing a
    // stale full snapshot intentionally overwrites — e.g. settings import.
    await repo.setAll({ [KEY_A]: 'old', [KEY_B]: '27124' });
    await concurrentWriterChangesKeyA();

    await repo.setAll({ [KEY_A]: 'old', [KEY_B]: '27126' });

    expect(await repo.get(KEY_A)).toBe('old');
  });

  it('setAll with multiple keys merges over defaults without touching unstored keys', async () => {
    adapter.seed({ settings: { [KEY_A]: 'custom.host' } as Record<string, unknown> });

    await repo.setAll({ [KEY_B]: '8080' });

    expect(await repo.get(KEY_A)).toBe('custom.host');
    expect(await repo.get(KEY_B)).toBe('8080');
  });
});
