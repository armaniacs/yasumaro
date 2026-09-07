// @vitest-environment jsdom
/**
 * archiveValidation.test.ts
 * Unit tests for validateArchiveEngine / migrateArchiveStaging using a mock
 * SqliteEngine (the codebase pattern: real WASM SQLite runs only in E2E).
 *
 * Covers the Checking Team / adversarial review requirements:
 * - allowlist scan (D-1): view / trigger / virtual table (rootpage=0) rejection
 * - table_xinfo (D-2): hidden/generated columns, column type mismatch
 * - meta.record_count vs COUNT(*) consistency (reject for restore, warn for open)
 * - migrateArchiveStaging (D-3): missing column completion, extra column ignored
 */
import { describe, it, expect, vi } from 'vitest';
import type { SqliteEngine, SqliteRow, SqliteValue } from '../sqliteEngine.js';
import { validateArchiveEngine, migrateArchiveStaging } from '../opfsWorker/archiveValidation.js';
import { COLUMN_NAMES } from '../schema.js';

interface FakeObject {
  type: string;
  name: string;
  rootpage?: number;
}

interface FakeColumn {
  name: string;
  type: string;
  hidden?: number;
}

interface FakeEngineSpec {
  objects?: FakeObject[];
  columns?: FakeColumn[];
  actualCount?: number;
  metaRow?: Record<string, SqliteValue> | null;
  metaError?: Error;
  countError?: Error;
}

function makeEngine(spec: FakeEngineSpec): SqliteEngine & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async exec(sql: string): Promise<void> {
      calls.push(sql);
      if (spec.metaError && sql.includes('ALTER TABLE')) throw spec.metaError;
    },
    async query(sql: string): Promise<SqliteRow[]> {
      calls.push(sql);
      if (sql.includes('sqlite_master')) {
        if (sql.includes("name = 'yasumaro_archive_meta'")) {
          const hit = (spec.objects ?? []).some(
            (o) => o.type === 'table' && o.name === 'yasumaro_archive_meta',
          );
          return hit ? [{ name: 'yasumaro_archive_meta' }] : [];
        }
        return (spec.objects ?? []).map((o) => ({
          type: o.type,
          name: o.name,
          rootpage: o.rootpage ?? 1,
        }));
      }
      if (sql.includes('table_xinfo')) {
        return (spec.columns ?? []).map((c) => ({
          name: c.name,
          type: c.type,
          hidden: c.hidden ?? 0,
        }));
      }
      if (sql.includes('COUNT(*)')) {
        return [{ c: spec.actualCount ?? 0 }];
      }
      if (sql.includes('yasumaro_archive_meta')) {
        if (spec.metaError) throw spec.metaError;
        return spec.metaRow ? [spec.metaRow] : [];
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
    async close(): Promise<void> {
      calls.push('close');
    },
  } as SqliteEngine & { calls: string[] };
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

function fullColumns(): FakeColumn[] {
  return [
    { name: 'id', type: 'INTEGER' },
    ...COLUMN_NAMES.map((name) => ({
      name,
      type: name === 'scroll_ratio' ? 'REAL' : INTEGER_COLUMNS.has(name) ? 'INTEGER' : 'TEXT',
    })),
  ];
}

function validObjects(): FakeObject[] {
  return [
    { type: 'table', name: 'browsing_logs', rootpage: 2 },
    { type: 'table', name: 'yasumaro_archive_meta', rootpage: 3 },
    { type: 'table', name: 'sqlite_sequence', rootpage: 4 },
    { type: 'index', name: 'idx_logs_created', rootpage: 5 },
    { type: 'index', name: 'sqlite_autoindex_browsing_logs_1', rootpage: 6 },
  ];
}

function validMetaRow(): Record<string, SqliteValue> {
  return {
    archived_at: 1775000000000,
    cutoff_created_at: 1774969199999,
    cutoff_date: '2026-03-31',
    record_count: 3,
    include_deleted: 0,
    archive_format_version: 1,
    yasumaro_version: '6.7.112',
    max_id_at_archive: 100,
  };
}

const BASE_SPEC: FakeEngineSpec = {
  objects: validObjects(),
  columns: fullColumns(),
  actualCount: 3,
  metaRow: validMetaRow(),
};

describe('validateArchiveEngine — allowlist scan (D-1)', () => {
  it('accepts a well-formed archive (tables + indexes only, no triggers)', async () => {
    const engine = makeEngine(BASE_SPEC);
    const result = await validateArchiveEngine(engine, { recordCountMismatch: 'reject' });
    expect(result.recordCount).toBe(3);
    expect(result.meta?.cutoffDate).toBe('2026-03-31');
  });

  it('rejects a VIEW masquerading as browsing_logs', async () => {
    const engine = makeEngine({
      ...BASE_SPEC,
      objects: [
        { type: 'view', name: 'browsing_logs' },
        { type: 'table', name: 'yasumaro_archive_meta' },
      ],
    });
    await expect(validateArchiveEngine(engine)).rejects.toThrow(/view/i);
  });

  it('rejects trigger objects', async () => {
    const engine = makeEngine({
      ...BASE_SPEC,
      objects: [...validObjects(), { type: 'trigger', name: 'browsing_logs_ai' }],
    });
    await expect(validateArchiveEngine(engine)).rejects.toThrow(/trigger/i);
  });

  it('rejects virtual tables (rootpage=0)', async () => {
    const engine = makeEngine({
      ...BASE_SPEC,
      objects: [...validObjects(), { type: 'table', name: 'evil_fts', rootpage: 0 }],
    });
    await expect(validateArchiveEngine(engine)).rejects.toThrow(/virtual/i);
  });

  it('rejects unexpected tables', async () => {
    const engine = makeEngine({
      ...BASE_SPEC,
      objects: [...validObjects(), { type: 'table', name: 'attacker_data' }],
    });
    await expect(validateArchiveEngine(engine)).rejects.toThrow(/attacker_data/);
  });

  it('rejects unknown object types (fail-closed)', async () => {
    const engine = makeEngine({
      ...BASE_SPEC,
      objects: [...validObjects(), { type: 'weird', name: 'future_kind' }],
    });
    await expect(validateArchiveEngine(engine)).rejects.toThrow(/future_kind/);
  });
});

describe('validateArchiveEngine — table_xinfo (D-2)', () => {
  it('rejects hidden/generated columns', async () => {
    const columns = fullColumns().map((c) =>
      c.name === 'url' ? { ...c, hidden: 2 } : c,
    );
    const engine = makeEngine({ ...BASE_SPEC, columns });
    await expect(validateArchiveEngine(engine)).rejects.toThrow(/hidden|generated/i);
  });

  it('rejects column type mismatches against SCHEMA_SQL', async () => {
    const columns = fullColumns().map((c) =>
      c.name === 'created_at' ? { ...c, type: 'BLOB' } : c,
    );
    const engine = makeEngine({ ...BASE_SPEC, columns });
    await expect(validateArchiveEngine(engine)).rejects.toThrow(/created_at/);
  });
});

describe('validateArchiveEngine — meta.record_count consistency', () => {
  it('rejects when meta.record_count mismatches COUNT(*) in reject mode', async () => {
    const engine = makeEngine({ ...BASE_SPEC, actualCount: 5 });
    await expect(
      validateArchiveEngine(engine, { recordCountMismatch: 'reject' }),
    ).rejects.toThrow(/record_count/i);
  });

  it('warns (does not reject) in warn mode and returns the warning', async () => {
    const engine = makeEngine({ ...BASE_SPEC, actualCount: 5 });
    const result = await validateArchiveEngine(engine, { recordCountMismatch: 'warn' });
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/record_count/i);
  });
});

describe('migrateArchiveStaging (D-3)', () => {
  it('adds missing columns with the SCHEMA_SQL base type', async () => {
    const columns = fullColumns().filter((c) => c.name !== 'gist_synced');
    const engine = makeEngine({ ...BASE_SPEC, columns });
    await migrateArchiveStaging(engine);
    const alter = engine.calls.find((s) => s.includes('ALTER TABLE'));
    expect(alter).toBeDefined();
    expect(alter).toContain('gist_synced');
  });

  it('does not alter when all columns exist', async () => {
    const engine = makeEngine(BASE_SPEC);
    await migrateArchiveStaging(engine);
    expect(engine.calls.find((s) => s.includes('ALTER TABLE'))).toBeUndefined();
  });

  it('throws on hidden columns instead of migrating', async () => {
    const columns = fullColumns().map((c) =>
      c.name === 'content' ? { ...c, hidden: 1 } : c,
    );
    const engine = makeEngine({ ...BASE_SPEC, columns });
    await expect(migrateArchiveStaging(engine)).rejects.toThrow(/hidden|generated/i);
  });

  it('ignores extra columns (projection makes them harmless)', async () => {
    const columns = [...fullColumns(), { name: 'attacker_extra', type: 'TEXT' }];
    const engine = makeEngine({ ...BASE_SPEC, columns });
    await expect(migrateArchiveStaging(engine)).resolves.toBeUndefined();
  });
});

describe('validateArchiveEngine — closed engine safety', () => {
  it('does not leave the engine open when validation rejects', async () => {
    const engine = makeEngine({
      ...BASE_SPEC,
      objects: [...validObjects(), { type: 'trigger', name: 'evil' }],
    });
    await expect(validateArchiveEngine(engine)).rejects.toThrow();
    expect(engine.calls).toContain('close');
  });

  it('validation does not close the engine on success (caller owns lifecycle)', async () => {
    const engine = makeEngine(BASE_SPEC);
    await validateArchiveEngine(engine);
    expect(engine.calls).not.toContain('close');
  });
});

describe('validateArchiveEngine — meta error resilience', () => {
  it('propagates meta read errors as validation failures', async () => {
    const engine = makeEngine({ ...BASE_SPEC, metaError: new Error('disk I/O error') });
    await expect(validateArchiveEngine(engine)).rejects.toThrow(/disk I\/O error/);
  });

  it('handles a missing meta row (empty table) via the mismatch policy', async () => {
    const engine = makeEngine({ ...BASE_SPEC, metaRow: null });
    await expect(
      validateArchiveEngine(engine, { recordCountMismatch: 'reject' }),
    ).rejects.toThrow(/meta/i);
  });
});
