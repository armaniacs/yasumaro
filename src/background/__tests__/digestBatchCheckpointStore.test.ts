/**
 * digestBatchCheckpointStore.test.ts
 * PBI 2026-10-22-03: production checkpoint store for the weekly digest
 * batch — module-owned checkpoint key, shared completion marker, fail-closed
 * validation.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  DIGEST_BATCH_CHECKPOINT_KEY,
  createDigestBatchCheckpointStore,
  createProductionDigestBatchCheckpointStore,
  validateDigestBatchCheckpoint,
} from '../digestBatchCheckpointStore.js';
import { StorageKeys } from '../../utils/storage/types.js';
import type { SettingsReader, SettingsRepository } from '../../utils/storage/SettingsRepository.js';
import type { StorageArea } from '../../utils/ports.js';

/**
 * In-memory StorageArea (the ports.ts shape the production store injects).
 * Not the storagePort.ts InMemoryStoragePort: that one implements the flat
 * StoragePort shape, not this Pick<StorageArea, 'get' | 'set' | 'remove'>.
 */
function makeMemoryArea(): Pick<StorageArea, 'get' | 'set' | 'remove'> {
  const store = new Map<string, unknown>();
  return {
    async get<T extends Record<string, unknown>>(keys: string[]): Promise<Partial<T>> {
      const out: Record<string, unknown> = {};
      for (const key of keys) {
        if (store.has(key)) out[key] = store.get(key);
      }
      return out as Partial<T>;
    },
    async set(items: Record<string, unknown>): Promise<void> {
      for (const [key, value] of Object.entries(items)) store.set(key, value);
    },
    async remove(keys: string[]): Promise<void> {
      for (const key of keys) store.delete(key);
    },
  };
}

function makeReader(marker: string): SettingsReader {
  const settings = { [StorageKeys.REVIEW_SUMMARY_LAST_GENERATED_WEEK]: marker } as never;
  return {
    getAll: vi.fn(async () => settings),
    getMany: vi.fn(async () => settings),
  } as unknown as SettingsReader;
}

function makeWriter(): Pick<SettingsRepository, 'set'> & { set: ReturnType<typeof vi.fn> } {
  return { set: vi.fn(async () => {}) };
}

function makeStore(marker: string) {
  const area = makeMemoryArea();
  const reader = makeReader(marker);
  const writer = makeWriter();
  const store = createDigestBatchCheckpointStore({
    storage: area,
    settingsReader: reader,
    settingsWriter: writer,
  });
  return { area, reader, writer, store };
}

const VALID_CHECKPOINT = { periodKey: '2026-W43', nextIndex: 2, processedIds: [1, 2] };

/**
 * Corrupt shapes are intentionally off-type: the validator must reject them
 * at runtime (storage is untrusted), so they arrive through this cast.
 */
type CheckpointArg = Parameters<typeof validateDigestBatchCheckpoint>[0];
function corrupt(value: unknown): CheckpointArg {
  return value as CheckpointArg;
}

describe('validateDigestBatchCheckpoint', () => {
  it('accepts a well-formed checkpoint', () => {
    expect(validateDigestBatchCheckpoint(VALID_CHECKPOINT)).toEqual(VALID_CHECKPOINT);
  });

  it('fails closed to null on missing or malformed shapes', () => {
    expect(validateDigestBatchCheckpoint(null)).toBeNull();
    expect(validateDigestBatchCheckpoint(undefined)).toBeNull();
    expect(validateDigestBatchCheckpoint({})).toBeNull();
    expect(validateDigestBatchCheckpoint({ ...VALID_CHECKPOINT, periodKey: '' })).toBeNull();
    expect(validateDigestBatchCheckpoint(corrupt({ ...VALID_CHECKPOINT, periodKey: 42 }))).toBeNull();
    expect(validateDigestBatchCheckpoint({ ...VALID_CHECKPOINT, nextIndex: -1 })).toBeNull();
    expect(validateDigestBatchCheckpoint({ ...VALID_CHECKPOINT, nextIndex: 1.5 })).toBeNull();
    expect(validateDigestBatchCheckpoint(corrupt({ ...VALID_CHECKPOINT, nextIndex: '2' }))).toBeNull();
    expect(validateDigestBatchCheckpoint(corrupt({ ...VALID_CHECKPOINT, processedIds: 'ids' }))).toBeNull();
    expect(validateDigestBatchCheckpoint(corrupt({ ...VALID_CHECKPOINT, processedIds: [1, '2'] }))).toBeNull();
  });
});

describe('createDigestBatchCheckpointStore', () => {
  it('round-trips the checkpoint through the injected storage area', async () => {
    const { store } = makeStore('');
    expect(await store.loadCheckpoint()).toBeNull();
    await store.saveCheckpoint(VALID_CHECKPOINT);
    expect(await store.loadCheckpoint()).toEqual(VALID_CHECKPOINT);
    await store.clearCheckpoint();
    expect(await store.loadCheckpoint()).toBeNull();
  });

  it('fails closed when the stored checkpoint shape is corrupt', async () => {
    const { area, store } = makeStore('');
    await area.set({ [DIGEST_BATCH_CHECKPOINT_KEY]: { periodKey: 7, nextIndex: 'x' } });
    expect(await store.loadCheckpoint()).toBeNull();
  });

  it('reads the shared weekly marker through the settings reader', async () => {
    const { reader, store } = makeStore('2026-W43');
    expect(await store.loadCompletedPeriod()).toBe('2026-W43');
    // Same seam the weekly generator checks (blob-authoritative getAll).
    expect(reader.getAll).toHaveBeenCalledTimes(1);
    const empty = makeStore('');
    expect(await empty.store.loadCompletedPeriod()).toBeNull();
  });

  it('writes the marker through the settings writer when unset (no raw storage set)', async () => {
    const { writer, area, store } = makeStore('');
    await store.saveCompletedPeriod('2026-W43');
    expect(writer.set).toHaveBeenCalledWith(StorageKeys.REVIEW_SUMMARY_LAST_GENERATED_WEEK, '2026-W43');
    // The checkpoint key is untouched: the marker rides the settings seam.
    expect(await area.get([DIGEST_BATCH_CHECKPOINT_KEY])).toEqual({});
  });

  it('keeps the completion marker a single write when it already matches', async () => {
    const { writer, store } = makeStore('2026-W43');
    await store.saveCompletedPeriod('2026-W43');
    // The publisher (generateWeeklySummary) already wrote the marker inside
    // publishDigest: a matching marker is skipped, not re-written.
    expect(writer.set).not.toHaveBeenCalled();
  });

  it('overwrites a stale marker for another period', async () => {
    const { writer, store } = makeStore('2026-W42');
    await store.saveCompletedPeriod('2026-W43');
    expect(writer.set).toHaveBeenCalledWith(StorageKeys.REVIEW_SUMMARY_LAST_GENERATED_WEEK, '2026-W43');
  });

  it('does not regress the marker to an older period (週替わり TOCTOU 単調性ガード)', async () => {
    const { writer, store } = makeStore('2026-W44');
    // The AI call inside publishDigest outlived the week: a late save for the
    // older period must not overwrite the newer completion marker — the
    // weekly alarm's later run would otherwise see the older marker and
    // re-publish the newer week.
    await store.saveCompletedPeriod('2026-W43');
    expect(writer.set).not.toHaveBeenCalled();
  });

  it('keeps writing through untrusted marker shapes (a corrupt marker cannot wedge the batch)', async () => {
    const { writer, store } = makeStore('legacy-value');
    await store.saveCompletedPeriod('2026-W43');
    expect(writer.set).toHaveBeenCalledWith(StorageKeys.REVIEW_SUMMARY_LAST_GENERATED_WEEK, '2026-W43');
  });

  it('defaults the production wiring to the shared storage port and settings repo', async () => {
    // The production factory resolves its defaults lazily; with an injected
    // reader/writer/storage it must behave like the plain factory.
    const area = makeMemoryArea();
    const reader = makeReader('');
    const writer = makeWriter();
    const store = createProductionDigestBatchCheckpointStore(reader, writer, area);
    await store.saveCheckpoint(VALID_CHECKPOINT);
    expect(await store.loadCheckpoint()).toEqual(VALID_CHECKPOINT);
    await store.saveCompletedPeriod('2026-W43');
    expect(writer.set).toHaveBeenCalledWith(StorageKeys.REVIEW_SUMMARY_LAST_GENERATED_WEEK, '2026-W43');
  });
});
