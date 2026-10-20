/**
 * Unit tests for opfsRecovery.ts (PBI 2026-10-18-19).
 * Covers the background OPFS recovery migration's field mapping: the fallback
 * store holds the only copy of rows whose INSERT failed, so every field —
 * especially fallback_reason, the only evidence of why the autosave rejected
 * the content — must survive the batch conversion. The key-set coverage test
 * pins convertFallbackRecord's output against COLUMN_NAMES so a future schema
 * column cannot silently drop fields again.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpfsRecoveryService } from '../opfsRecovery.js';
import { StorageKeys } from '../../../utils/storage/types.js';
import { COLUMN_NAMES, buildInsertRecordFields } from '../../../offscreen/schema.js';
import type { SqliteClient, SqliteResult } from '../../sqlite/offscreenGateway.js';
import type { MutateOp } from '../../../messaging/sqliteRpcClient.js';
import type { BrowsingLogRecord } from '../../../utils/sqlite-types.js';

/** Module-private constant in opfsRecovery.ts — pinned here so a rename fails this suite. */
const FALLBACK_STORAGE_KEY = 'FALLBACK_STORAGE_DATA';

type InsertBatchOp = Extract<MutateOp, { type: 'insertBatch' }>;

/** insertBatch payloads captured from the stubbed client, in call order. */
const capturedBatches: InsertBatchOp[] = [];

vi.mock('../../sqlite/offscreenGateway.js', () => ({
  SqliteClient: class {},
}));

function makeStubClient(): SqliteClient {
  const mutate = async (op: MutateOp): Promise<SqliteResult<{ count: number; skipped: number }>> => {
    if (op.type === 'insertBatch') capturedBatches.push(op);
    return { success: true, data: { count: 1, skipped: 0 } };
  };
  const getStatus = async (): Promise<{ initialized: boolean; path: string; fallback: boolean } | null> => ({
    initialized: true,
    path: '',
    fallback: false,
  });
  return { mutate, getStatus } as SqliteClient;
}

function makeSeedRecord(extra: Partial<BrowsingLogRecord> = {}): BrowsingLogRecord {
  return { url: 'https://example.com/page', created_at: 1_760_000_000_000, ...extra };
}

async function seedFallbackStorage(records: BrowsingLogRecord[]): Promise<void> {
  await chrome.storage.local.set({
    [StorageKeys.OPFS_FALLBACK_MODE]: true,
    [FALLBACK_STORAGE_KEY]: { records },
  });
}

/** Runs migrate() against a fresh stub and returns the first captured batch's records. */
async function migrateAndCapture(): Promise<BrowsingLogRecord[]> {
  const service = new OpfsRecoveryService(makeStubClient());
  const result = await service.migrate();
  expect(result.success).toBe(true);
  expect(capturedBatches).toHaveLength(1);
  return capturedBatches[0]!.records;
}

describe('OpfsRecoveryService field mapping', () => {
  beforeEach(() => {
    capturedBatches.length = 0;
  });

  it('keeps fallback_reason on every record passed to insertBatch (Scenario 1)', async () => {
    await seedFallbackStorage([
      makeSeedRecord({ title: 'Page title', fallback_triggered: 1, fallback_reason: 'short_content' }),
    ]);

    const service = new OpfsRecoveryService(makeStubClient());
    // Recovery gate: fallback mode on + a healthy SQLite engine + data present.
    await expect(service.needsMigration()).resolves.toBe(true);

    const result = await service.migrate();
    expect(result).toEqual({ success: true, migrated: 1 });

    expect(capturedBatches).toHaveLength(1);
    const migrated = capturedBatches[0]!.records[0]!;
    expect(migrated.fallback_reason).toBe('short_content');
    // Other fields keep the same defaults as before the fix.
    expect(migrated.fallback_triggered).toBe(1);
    expect(migrated.nav_source_url).toBeNull();
    expect(migrated.search_query).toBeNull();
    expect(migrated.title).toBe('Page title');
    expect(migrated.url).toBe('https://example.com/page');

    // Existing deletion order is unchanged: the store first, then the flag.
    expect(chrome.storage.local.remove).toHaveBeenNthCalledWith(1, FALLBACK_STORAGE_KEY);
    expect(chrome.storage.local.remove).toHaveBeenNthCalledWith(2, StorageKeys.OPFS_FALLBACK_MODE);
  });

  it('produces the same values as the offscreen sibling path for the same row (Scenario 2)', async () => {
    const seed = makeSeedRecord({
      title: 'Kept summary',
      summary: 'kept',
      domain: 'example.com',
      fallback_triggered: 1,
      fallback_reason: 'over_cleansed',
    });
    await seedFallbackStorage([seed]);

    const migrated = (await migrateAndCapture())[0]!;

    // The sibling path (fallbackMigration.ts) inserts the raw record via
    // buildInsertParams — buildInsertRecordFields is its object-shaped twin.
    const sibling = buildInsertRecordFields(seed, seed.domain ?? null);
    expect(migrated.fallback_reason).toBe('over_cleansed');
    expect(sibling.fallback_reason).toBe('over_cleansed');
    for (const column of COLUMN_NAMES) {
      expect(migrated[column]).toBe(sibling[column]);
    }
  });

  it('stores NULL for an old row that has no fallback_reason (Scenario 3)', async () => {
    // Rows written before the opt-in existed carry neither reason nor trail.
    await seedFallbackStorage([makeSeedRecord({ title: 'Old page' })]);

    const migrated = (await migrateAndCapture())[0]!;

    expect(migrated.fallback_reason).toBeNull();
    // The key is present with null — not 'null' as a string, not an empty
    // string, and not a missing key.
    expect(Object.prototype.hasOwnProperty.call(migrated, 'fallback_reason')).toBe(true);
    expect(migrated.fallback_reason).not.toBe('null');
    expect(migrated.fallback_reason).not.toBe('');
    expect(migrated.nav_source_url).toBeNull();
    expect(migrated.search_query).toBeNull();
  });

  it('fails the coverage check when a new COLUMN_NAMES entry is not mapped (Scenario 4)', async () => {
    await seedFallbackStorage([makeSeedRecord({ fallback_reason: 'content_overcut' })]);

    const migrated = (await migrateAndCapture())[0]!;
    const producedKeys = Object.keys(migrated).sort();
    const ssotKeys = [...COLUMN_NAMES].sort();

    // Every COLUMN_NAMES entry is mapped, in the exact key set.
    expect(producedKeys).toEqual(ssotKeys);

    // A hypothetical new column would be detected as exactly that difference,
    // so a future schema addition cannot silently drop fields again.
    const drifted = [...ssotKeys, 'future_column'].sort();
    expect(producedKeys).not.toEqual(drifted);
    expect(drifted.filter((name) => !producedKeys.includes(name))).toEqual(['future_column']);
  });
});
