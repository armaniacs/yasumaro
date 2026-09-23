// @vitest-environment jsdom
/**
 * archiveValidationResourceCaps.test.ts
 * Boundary tests for the worker-side restore ceilings enforced by
 * validateArchiveEngine (PBI 2026-09-22-08, VULN-004).
 *
 * Row ceiling: ceiling-1 / ceiling / ceiling+1 on observed COUNT(*), plus a
 * declared-total (meta.record_count) probe in warn mode.
 * Byte ceiling: staged file bytes (PRAGMA page_count x page_size) at
 * ceiling-1 / ceiling / ceiling+1.
 */
import { describe, it, expect } from 'vitest';
import type { SqliteEngine, SqliteRow, SqliteValue } from '../sqliteEngine.js';
import { validateArchiveEngine } from '../opfsWorker/archiveValidation.js';
import {
  MAX_ARCHIVE_RESTORE_BYTES,
  MAX_ARCHIVE_RESTORE_ROWS,
} from '../opfsWorker/archiveGuards.js';
import { COLUMN_NAMES } from '../schema.js';

interface FakeObject {
  type: string;
  name: string;
  rootpage?: number;
}

interface FakeEngineSpec {
  objects?: FakeObject[];
  actualCount?: number;
  metaRecordCount?: number;
  pageCount?: number | null;
  pageSize?: number | null;
}

const INTEGER_COLUMNS = new Set([
  'created_at', 'visit_duration', 'is_starred', 'is_deleted', 'obsidian_synced',
  'gist_synced', 'masked_count', 'ai_duration_ms', 'obsidian_duration_ms',
  'sent_tokens', 'received_tokens', 'original_tokens', 'cleansed_tokens',
  'page_bytes', 'candidate_bytes', 'original_bytes', 'cleansed_bytes',
  'ai_summary_original_bytes', 'ai_summary_cleansed_bytes',
  'extracted_sentences_bytes', 'extracted_sentences_original_bytes',
  'fallback_triggered',
]);

function fullColumns() {
  return [
    { name: 'id', type: 'INTEGER', hidden: 0 },
    ...COLUMN_NAMES.map((name) => ({
      name,
      type: name === 'scroll_ratio' ? 'REAL' : INTEGER_COLUMNS.has(name) ? 'INTEGER' : 'TEXT',
      hidden: 0,
    })),
  ];
}

function validObjects(): FakeObject[] {
  return [
    { type: 'table', name: 'browsing_logs', rootpage: 2 },
    { type: 'table', name: 'yasumaro_archive_meta', rootpage: 3 },
    { type: 'table', name: 'sqlite_sequence', rootpage: 4 },
    { type: 'index', name: 'idx_logs_created', rootpage: 5 },
  ];
}

function makeEngine(spec: FakeEngineSpec): SqliteEngine {
  const actualCount = spec.actualCount ?? 3;
  const metaRecordCount = spec.metaRecordCount ?? actualCount;
  const pageCount = spec.pageCount ?? 10;
  const pageSize = spec.pageSize ?? 4096;
  return {
    async exec(): Promise<void> {},
    async query(sql: string): Promise<SqliteRow[]> {
      if (sql.includes('PRAGMA page_count')) {
        return pageCount === null ? [] : [{ page_count: pageCount }];
      }
      if (sql.includes('PRAGMA page_size')) {
        return pageSize === null ? [] : [{ page_size: pageSize }];
      }
      if (sql.includes('sqlite_master')) {
        return (spec.objects ?? validObjects()).map((o) => ({
          type: o.type,
          name: o.name,
          rootpage: o.rootpage ?? 1,
        }));
      }
      if (sql.includes('table_xinfo')) {
        return fullColumns();
      }
      if (sql.includes('COUNT(*)')) {
        return [{ c: actualCount }];
      }
      if (sql.includes('yasumaro_archive_meta')) {
        return [{
          archived_at: 1775000000000,
          cutoff_created_at: 1774969199999,
          cutoff_date: '2026-03-31',
          record_count: metaRecordCount,
          include_deleted: 0,
          archive_format_version: 1,
          yasumaro_version: '6.7.113',
          max_id_at_archive: 100,
        }];
      }
      return [];
    },
    async queryValue(sql: string): Promise<SqliteValue> {
      const rows = await this.query(sql);
      const first = rows[0];
      if (!first) return null;
      const key = Object.keys(first)[0];
      return key !== undefined ? (first[key] ?? null) : null;
    },
    async close(): Promise<void> {},
  } as SqliteEngine;
}

describe('validateArchiveEngine — row ceiling (ARC_CAP_001)', () => {
  it('accepts ceiling-1 observed rows', async () => {
    const engine = makeEngine({
      actualCount: MAX_ARCHIVE_RESTORE_ROWS - 1,
      metaRecordCount: MAX_ARCHIVE_RESTORE_ROWS - 1,
    });
    const result = await validateArchiveEngine(engine, { recordCountMismatch: 'reject' });
    expect(result.recordCount).toBe(MAX_ARCHIVE_RESTORE_ROWS - 1);
  });

  it('accepts exactly the ceiling observed rows', async () => {
    const engine = makeEngine({
      actualCount: MAX_ARCHIVE_RESTORE_ROWS,
      metaRecordCount: MAX_ARCHIVE_RESTORE_ROWS,
    });
    const result = await validateArchiveEngine(engine, { recordCountMismatch: 'reject' });
    expect(result.recordCount).toBe(MAX_ARCHIVE_RESTORE_ROWS);
  });

  it('rejects ceiling+1 observed rows with ARC_CAP_001', async () => {
    const engine = makeEngine({
      actualCount: MAX_ARCHIVE_RESTORE_ROWS + 1,
      metaRecordCount: MAX_ARCHIVE_RESTORE_ROWS + 1,
    });
    await expect(
      validateArchiveEngine(engine, { recordCountMismatch: 'reject' }),
    ).rejects.toThrow(/ARC_CAP_001/);
  });

  it('rejects a lying declared total even in warn mode', async () => {
    const engine = makeEngine({
      actualCount: 3,
      metaRecordCount: MAX_ARCHIVE_RESTORE_ROWS + 1,
    });
    await expect(
      validateArchiveEngine(engine, { recordCountMismatch: 'warn' }),
    ).rejects.toThrow(/ARC_CAP_001/);
  });
});

describe('validateArchiveEngine — byte ceiling (ARC_CAP_002)', () => {
  // page_size 1 keeps the boundary exact at byte granularity.
  const pageSize = 1;
  const atCeiling = MAX_ARCHIVE_RESTORE_BYTES / pageSize;

  it('accepts a staged file one byte under the ceiling', async () => {
    const engine = makeEngine({ pageCount: atCeiling - 1, pageSize });
    const result = await validateArchiveEngine(engine, { recordCountMismatch: 'reject' });
    expect(result.recordCount).toBe(3);
  });

  it('accepts a staged file exactly at the ceiling', async () => {
    const engine = makeEngine({ pageCount: atCeiling, pageSize });
    const result = await validateArchiveEngine(engine, { recordCountMismatch: 'reject' });
    expect(result.recordCount).toBe(3);
  });

  it('rejects a staged file one byte over the ceiling with ARC_CAP_002', async () => {
    const engine = makeEngine({ pageCount: atCeiling + 1, pageSize });
    await expect(
      validateArchiveEngine(engine, { recordCountMismatch: 'reject' }),
    ).rejects.toThrow(/ARC_CAP_002/);
  });

  it('skips the byte gate when the engine cannot report size', async () => {
    const engine = makeEngine({ pageCount: null, pageSize: null });
    const result = await validateArchiveEngine(engine, { recordCountMismatch: 'reject' });
    expect(result.recordCount).toBe(3);
  });
});
