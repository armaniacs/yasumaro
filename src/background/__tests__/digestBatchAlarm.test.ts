/**
 * digestBatchAlarm.test.ts
 * PBI 2026-10-22-03: the alarm run body of the weekly digest batch —
 * execution-time gates, shared-marker unification, publish delegation,
 * run-token staleness. runDigestBatch's own chunk/resume/idempotency
 * mechanics are pinned by digestBatchJob.test.ts; this file pins the wiring.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitForMock } from '../../../testDir/waitPolicy.js';
import { runReviewDigestBatch, DIGEST_BATCH_CHUNK_SIZE } from '../digestBatchAlarm.js';
import { DIGEST_BATCH_CHECKPOINT_KEY } from '../digestBatchCheckpointStore.js';
import { buildWeekPeriod } from '../reviewSummaryGenerator.js';
import type { ReviewSummaryGenerator } from '../reviewSummaryGenerator.js';
import type { AlarmHandlerDeps } from '../alarmRegistry.js';
import type { SettingsReader, SettingsRepository } from '../../utils/storage/SettingsRepository.js';
import type { StorageArea } from '../../utils/ports.js';
import { StorageKeys } from '../../utils/storage/types.js';
import type { SqliteClient } from '../sqlite/offscreenGateway.js';
import type { BrowsingLogRecord } from '../../utils/sqlite-types.js';

const WEEK_KEY = buildWeekPeriod(new Date()).storageKey;

/** In-memory StorageArea (the ports.ts shape the production store injects). */
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

/**
 * The settings object is returned by reference so a test can simulate the
 * publisher writing the shared marker mid-run (the seam the production
 * store reads through getAll()).
 */
function makeReader(enabled: boolean, marker = ''): {
  reader: SettingsReader;
  settings: Record<string, unknown>;
} {
  const settings: Record<string, unknown> = {
    [StorageKeys.REVIEW_SUMMARY_ENABLED]: enabled,
    [StorageKeys.REVIEW_SUMMARY_LAST_GENERATED_WEEK]: marker,
  };
  return {
    reader: {
      getAll: vi.fn(async () => settings),
      getMany: vi.fn(async () => settings),
    } as unknown as SettingsReader,
    settings,
  };
}

function makeWriter() {
  return { set: vi.fn(async () => {}) };
}

type QueryRow = BrowsingLogRecord;

function querySuccess(rows: QueryRow[]): { success: true; data: { rows: QueryRow[]; total: number } } {
  return { success: true, data: { rows, total: rows.length } };
}

function makeQuery(rows: QueryRow[]): ReturnType<typeof vi.fn> {
  return vi.fn(async () => querySuccess(rows));
}

function makeGenerator(overrides: Partial<ReviewSummaryGenerator> = {}): ReviewSummaryGenerator {
  return {
    generateWeeklySummary: vi.fn(async () => false),
    generateMonthlySummary: vi.fn(async () => false),
    ...overrides,
  } as unknown as ReviewSummaryGenerator;
}

/** Rows as the query returns them: newest first. */
function makeRows(summaries: string[]): QueryRow[] {
  return summaries.map((summary, index) => ({
    id: index + 1,
    url: `https://a.example/p${index + 1}`,
    title: `Page ${index + 1}`,
    summary,
    created_at: Date.UTC(2026, 0, 1) + index * 1000,
    domain: 'a.example',
  })) as QueryRow[];
}

function makeDeps(overrides: {
  enabled?: boolean;
  consent?: boolean;
  marker?: string;
  query?: ReturnType<typeof vi.fn>;
  generator?: ReviewSummaryGenerator;
} = {}): AlarmHandlerDeps & {
  readerSettings: Record<string, unknown>;
  writer: { set: ReturnType<typeof vi.fn> };
} {
  const area = makeMemoryArea();
  const { reader, settings } = makeReader(overrides.enabled ?? true, overrides.marker ?? '');
  const writer = makeWriter();
  return {
    sqliteClient: { query: overrides.query ?? makeQuery([]) } as unknown as SqliteClient,
    recordingPipeline: {} as never,
    getOfflineNetworkQueue: () => ({}) as never,
    isConsentGranted: async () => overrides.consent ?? true,
    retryPendingChromeStorageWrite: vi.fn(async () => true),
    reviewSummaryGenerator: overrides.generator ?? makeGenerator(),
    sessionAlarmService: {} as never,
    sessionReminderAlarms: { start: vi.fn(async () => {}), checkToday: vi.fn(async () => {}) } as never,
    settingsReader: reader,
    settingsWriter: writer,
    digestBatchStorage: area,
    readerSettings: settings,
    writer,
  } as AlarmHandlerDeps & {
    readerSettings: Record<string, unknown>;
    writer: { set: ReturnType<typeof vi.fn> };
  };
}

function storageOf(
  deps: AlarmHandlerDeps & { readerSettings: Record<string, unknown>; writer: { set: ReturnType<typeof vi.fn> } },
): Pick<StorageArea, 'get' | 'set' | 'remove'> {
  return deps.digestBatchStorage as Pick<StorageArea, 'get' | 'set' | 'remove'>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runReviewDigestBatch — execution-time gates', () => {
  it('returns without fetching when the setting is disabled', async () => {
    const query = makeQuery(makeRows(['a']));
    const generator = makeGenerator();
    const deps = makeDeps({ enabled: false, query, generator });
    await runReviewDigestBatch(deps);
    expect(query).not.toHaveBeenCalled();
    expect(generator.generateWeeklySummary).not.toHaveBeenCalled();
  });

  it('returns without fetching when the consent is withdrawn (設定は実行時に再読込)', async () => {
    const query = makeQuery(makeRows(['a']));
    const generator = makeGenerator();
    const deps = makeDeps({ consent: false, query, generator });
    await runReviewDigestBatch(deps);
    expect(query).not.toHaveBeenCalled();
    expect(generator.generateWeeklySummary).not.toHaveBeenCalled();
  });

  it('returns without fetching when the period has no entries', async () => {
    const query = makeQuery([]);
    const generator = makeGenerator();
    const deps = makeDeps({ query, generator });
    await runReviewDigestBatch(deps);
    expect(query).toHaveBeenCalledTimes(1);
    expect(generator.generateWeeklySummary).not.toHaveBeenCalled();
  });

  it('returns and drops the dead checkpoint when the week is already completed', async () => {
    const query = makeQuery(makeRows(['a']));
    const generator = makeGenerator();
    const deps = makeDeps({ query, generator, marker: WEEK_KEY });
    const port = storageOf(deps);
    await port.set({ [DIGEST_BATCH_CHECKPOINT_KEY]: { periodKey: WEEK_KEY, nextIndex: 1, processedIds: [1] } });
    await runReviewDigestBatch(deps);
    expect(query).not.toHaveBeenCalled();
    expect(generator.generateWeeklySummary).not.toHaveBeenCalled();
    // 他期間の検査点は捨てる: a completed week's checkpoint is dead progress.
    expect(await port.get([DIGEST_BATCH_CHECKPOINT_KEY])).toEqual({});
  });
});

describe('runReviewDigestBatch — publish and marker unification', () => {
  it('delegates the publish to the weekly generator and unifies the marker', async () => {
    const query = makeQuery(makeRows(['alpha', 'beta', 'gamma']));
    const generator = makeGenerator({ generateWeeklySummary: vi.fn(async () => true) });
    const deps = makeDeps({ query, generator });
    await runReviewDigestBatch(deps);
    expect(generator.generateWeeklySummary).toHaveBeenCalledTimes(1);
    expect(generator.generateMonthlySummary).not.toHaveBeenCalled();
    // 標識統一: the same shared key, the same 'YYYY-Www' value.
    expect(deps.writer.set).toHaveBeenCalledWith(
      StorageKeys.REVIEW_SUMMARY_LAST_GENERATED_WEEK,
      WEEK_KEY,
    );
    const port = storageOf(deps);
    expect(await port.get([DIGEST_BATCH_CHECKPOINT_KEY])).toEqual({});
  });

  it('does not write the shared marker twice when the publisher already wrote it', async () => {
    const query = makeQuery(makeRows(['alpha', 'beta']));
    const generator = makeGenerator({ generateWeeklySummary: vi.fn(async () => true) });
    const deps = makeDeps({ query, generator });
    // The publisher (generateWeeklySummary) writes the marker through the
    // same seam inside publishDigest: the store's saveCompletedPeriod sees
    // the matching marker and skips its own write.
    deps.writer.set.mockImplementation(async (_key: string, value: string) => {
      deps.readerSettings[StorageKeys.REVIEW_SUMMARY_LAST_GENERATED_WEEK] = value;
    });
    await runReviewDigestBatch(deps);
    expect(deps.writer.set).toHaveBeenCalledTimes(1);
  });

  it('keeps the checkpoint when the publish fails (no marker write)', async () => {
    const query = makeQuery(makeRows(['alpha', 'beta']));
    const generator = makeGenerator({ generateWeeklySummary: vi.fn(async () => false) });
    const deps = makeDeps({ query, generator });
    await runReviewDigestBatch(deps);
    expect(generator.generateWeeklySummary).toHaveBeenCalledTimes(1);
    expect(deps.writer.set).not.toHaveBeenCalled();
    const port = storageOf(deps);
    const stored = await port.get([DIGEST_BATCH_CHECKPOINT_KEY]);
    const checkpoint = stored[DIGEST_BATCH_CHECKPOINT_KEY] as { nextIndex: number } | undefined;
    expect(checkpoint?.nextIndex).toBe(2);
  });

  it('skips rows without a usable summary, same entry rule as the weekly generator', async () => {
    const rows = makeRows(['alpha']);
    rows.push({ id: 9, url: 'https://a.example/p9', title: 'No summary', summary: null, created_at: Date.UTC(2026, 0, 2), domain: 'a.example' } as QueryRow);
    const query = makeQuery(rows);
    const generator = makeGenerator({ generateWeeklySummary: vi.fn(async () => true) });
    const deps = makeDeps({ query, generator });
    await runReviewDigestBatch(deps);
    expect(generator.generateWeeklySummary).toHaveBeenCalledTimes(1);
  });
});

describe('runReviewDigestBatch — run token', () => {
  it('lets a newer tick finish and stops the older run without a second publish', async () => {
    const deferreds: Array<(value: ReturnType<typeof querySuccess>) => void> = [];
    const query = vi.fn(
      () => new Promise<ReturnType<typeof querySuccess>>((resolve) => { deferreds.push(resolve); }),
    );
    const generator = makeGenerator({ generateWeeklySummary: vi.fn(async () => true) });
    const deps = makeDeps({ query, generator });
    const rows = makeRows(['alpha', 'beta']);

    const first = runReviewDigestBatch(deps);
    await waitForMock(() => expect(query).toHaveBeenCalledTimes(1));
    const second = runReviewDigestBatch(deps);
    await waitForMock(() => expect(query).toHaveBeenCalledTimes(2));

    // The newer tick runs to completion and publishes.
    deferreds[1]!(querySuccess(rows));
    await second;
    expect(generator.generateWeeklySummary).toHaveBeenCalledTimes(1);

    // The older run is stale: no second publish, no second marker write.
    deferreds[0]!(querySuccess(rows));
    await first;
    expect(generator.generateWeeklySummary).toHaveBeenCalledTimes(1);
    expect(deps.writer.set).toHaveBeenCalledTimes(1);
  });
});

describe('DIGEST_BATCH_CHUNK_SIZE', () => {
  it('stays at or above the 200-entry refold floor (下限助言)', () => {
    expect(DIGEST_BATCH_CHUNK_SIZE).toBeGreaterThanOrEqual(200);
  });
});
