/**
 * migrations-comprehensive.test.ts
 * Comprehensive tests for runMigrations — covers FTS5 rebuild logic,
 * error propagation, idempotency, and all migration steps.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { runMigrations, IDEMPOTENT_DDL_ERROR_PATTERNS, type MigrationEngine } from '../migrations.js';

function createMockEngine(): MigrationEngine & {
  executedSql: string[];
  queryValueResult: number | null;
  shouldThrow: Map<string, string>;
} {
  const executedSql: string[] = [];
  const shouldThrow = new Map<string, string>();
  const engineObj: MigrationEngine & {
    executedSql: string[];
    queryValueResult: number | null;
    shouldThrow: Map<string, string>;
  } = {
    executedSql,
    queryValueResult: 0,
    shouldThrow,

    async exec(sql: string): Promise<void> {
      const errorMsg = shouldThrow.get(sql);
      if (errorMsg !== undefined) {
        throw new Error(errorMsg);
      }
      executedSql.push(sql);
    },

    async queryValue(_sql: string): Promise<number | null> {
      return engineObj.queryValueResult;
    },
  };
  return engineObj;
}

describe('runMigrations', () => {
  let engine: ReturnType<typeof createMockEngine>;

  beforeEach(() => {
    engine = createMockEngine();
  });

  // ── One-off migrations ──────────────────────────────────────────────

  it('runs obsidian_synced and gist_synced ALTER TABLE migrations', async () => {
    await runMigrations(engine);
    const sql = engine.executedSql.join('\n');
    expect(sql).toContain('ALTER TABLE browsing_logs ADD COLUMN obsidian_synced');
    expect(sql).toContain('ALTER TABLE browsing_logs ADD COLUMN gist_synced');
  });

  it('runs the gist_synced index creation', async () => {
    await runMigrations(engine);
    expect(engine.executedSql.some(s => s.includes('idx_logs_gist'))).toBe(true);
  });

  // ── ALTER TABLE migration columns ───────────────────────────────────

  it('runs all MIGRATION_COLUMNS ALTER TABLE statements', async () => {
    await runMigrations(engine);
    const alterStatements = engine.executedSql.filter(s => s.startsWith('ALTER TABLE'));
    // MIGRATION_COLUMNS has entries, each generates an ALTER TABLE
    expect(alterStatements.length).toBeGreaterThanOrEqual(19);
  });

  it('includes content TEXT and masked_count INTEGER in ALTER TABLE', async () => {
    await runMigrations(engine);
    const sql = engine.executedSql.join('\n');
    expect(sql).toContain('ADD COLUMN content TEXT');
    expect(sql).toContain('ADD COLUMN masked_count INTEGER');
    expect(sql).toContain('ADD COLUMN fallback_triggered INTEGER DEFAULT 0');
  });

  // ── FTS5 schema ─────────────────────────────────────────────────────

  it('runs all 4 FTS5 statements when no error occurs', async () => {
    await runMigrations(engine);
    const ftsStatements = engine.executedSql.filter(s =>
      s.includes('browsing_logs_fts') || s.includes('CREATE TRIGGER')
    );
    expect(ftsStatements.length).toBe(4);
  });

  it('sets fts5Available to true when FTS5 statements succeed', async () => {
    const result = await runMigrations(engine);
    expect(result.fts5Available).toBe(true);
  });

  it('sets fts5Available to false when FTS5 statements fail', async () => {
    engine.exec = async (sql: string) => {
      if (sql.includes('browsing_logs_fts') || sql.includes('CREATE TRIGGER')) {
        throw new Error('FTS5 not supported');
      }
      engine.executedSql.push(sql);
    };

    const result = await runMigrations(engine);
    expect(result.fts5Available).toBe(false);
  });

  // ── FTS5 rebuild logic ──────────────────────────────────────────────

  it('triggers FTS rebuild when base count > 0 and FTS count is 0', async () => {
    engine.queryValue = async (sql: string) => {
      if (sql.includes('COUNT(*)') && !sql.includes('fts')) {
        return 100; // base count > 0
      }
      if (sql.includes('browsing_logs_fts')) {
        return 0; // FTS count is 0
      }
      return 0;
    };

    await runMigrations(engine);
    expect(engine.executedSql.some(s => s.includes("VALUES('rebuild')"))).toBe(true);
  });

  it('does NOT trigger FTS rebuild when base count is 0', async () => {
    engine.queryValue = async () => 0;
    await runMigrations(engine);
    expect(engine.executedSql.some(s => s.includes("VALUES('rebuild')"))).toBe(false);
  });

  it('triggers FTS rebuild when FTS count is partially behind the base table', async () => {
    // 再構築の中断で部分投入されたインデックス（50/100）も修復対象
    engine.queryValue = async (sql: string) => {
      if (sql.includes('COUNT(*)') && !sql.includes('fts')) return 100;
      if (sql.includes('browsing_logs_fts')) return 50;
      return 0;
    };
    await runMigrations(engine);
    expect(engine.executedSql.some(s => s.includes("VALUES('rebuild')"))).toBe(true);
  });

  it('does NOT trigger FTS rebuild when FTS count >= base count (already rebuilt)', async () => {
    engine.queryValue = async (sql: string) => {
      if (sql.includes('COUNT(*)') && !sql.includes('fts')) return 100;
      if (sql.includes('browsing_logs_fts')) return 100;
      return 0;
    };
    await runMigrations(engine);
    expect(engine.executedSql.some(s => s.includes("VALUES('rebuild')"))).toBe(false);
  });

  // ── Idempotency ─────────────────────────────────────────────────────

  it('can be called multiple times without error', async () => {
    // "duplicate column name" errors should be silently caught
    engine.exec = async (sql: string) => {
      if (sql.includes('ALTER TABLE') && sql.includes('ADD COLUMN')) {
        throw new Error('duplicate column name');
      }
      engine.executedSql.push(sql);
    };

    await runMigrations(engine);
    await runMigrations(engine);
    // No error thrown means idempotency works
  });

  // ── Idempotency via pre-execution existence probe (PBI 2026-09-05-07) ──

  it('skips ALTER TABLE for columns that already exist, regardless of error wording', async () => {
    // pragma_table_info の pre-check で列が存在する場合、exec に到達しない —
    // SQLite のエラーメッセージ文言に冪等判定が依存しないことを検証する。
    const alterCalls: string[] = [];
    engine.queryValue = async (sql: string) => {
      if (sql.includes('pragma_table_info')) return 1; // 全列 存在済み
      return 0;
    };
    engine.exec = async (sql: string) => {
      if (sql.startsWith('ALTER TABLE')) {
        alterCalls.push(sql);
        throw new Error('cheese-flavored wording: no such operation'); // 文言がどんなでも到達しない
      }
      engine.executedSql.push(sql);
    };

    await expect(runMigrations(engine)).resolves.toBeDefined();
    expect(alterCalls).toHaveLength(0);
  });

  it('keeps the tolerated idempotent-DDL error patterns pinned', () => {
    // 定数化された許容パターンのテスト固定（文言変更はこのテストで検知する）
    expect(IDEMPOTENT_DDL_ERROR_PATTERNS.some(p => p.test('duplicate column name: content'))).toBe(true);
    expect(IDEMPOTENT_DDL_ERROR_PATTERNS.some(p => p.test('index idx_logs_gist already exists'))).toBe(true);
    expect(IDEMPOTENT_DDL_ERROR_PATTERNS.every(p => !p.test('disk I/O error'))).toBe(true);
    expect(IDEMPOTENT_DDL_ERROR_PATTERNS.every(p => !p.test('database locked'))).toBe(true);
  });

  it('throws a true failure even when the column does not exist yet', async () => {
    engine.queryValue = async (sql: string) => {
      if (sql.includes('pragma_table_info')) return 0; // 列は未存在
      return 0;
    };
    engine.exec = async (sql: string) => {
      if (sql.includes('ALTER TABLE')) {
        throw new Error('near "ALTER": syntax error');
      }
      engine.executedSql.push(sql);
    };

    await expect(runMigrations(engine)).rejects.toThrow('syntax error');
  });

  // ── Error propagation ───────────────────────────────────────────────

  it('throws non-duplicate-column errors from ALTER TABLE', async () => {
    engine.exec = async (sql: string) => {
      if (sql.includes('ALTER TABLE')) {
        throw new Error('disk I/O error');
      }
      engine.executedSql.push(sql);
    };

    await expect(runMigrations(engine)).rejects.toThrow('disk I/O error');
  });

  it('throws for GIST index database locked (not already exists)', async () => {
    engine.exec = async (sql: string) => {
      if (sql.includes('idx_logs_gist')) {
        throw new Error('database locked');
      }
      engine.executedSql.push(sql);
    };

    await expect(runMigrations(engine)).rejects.toThrow('database locked');
  });

  it('ignores GIST index already exists without throwing', async () => {
    engine.exec = async (sql: string) => {
      if (sql.includes('idx_logs_gist')) {
        throw new Error('already exists');
      }
      engine.executedSql.push(sql);
    };

    await expect(runMigrations(engine)).resolves.toBeDefined();
  });

  // ── Migration step ordering ─────────────────────────────────────────

  it('runs migration sequence before ALTER TABLE columns before FTS5', async () => {
    await runMigrations(engine);
    const sql = engine.executedSql;

    // First: MIGRATION_SEQUENCE (obsidian_synced, gist_synced)
    const obsIdx = sql.findIndex(s => s.includes('obsidian_synced'));
    const gistIdx = sql.findIndex(s => s.includes('gist_synced') && s.includes('ALTER'));
    // Then: GIST_SYNCED_INDEX
    const gistIndexIdx = sql.findIndex(s => s.includes('idx_logs_gist'));
    // Then: MIGRATION_COLUMNS
    const contentIdx = sql.findIndex(s => s.includes('ADD COLUMN content'));
    // Then: FTS5
    const ftsIdx = sql.findIndex(s => s.includes('CREATE VIRTUAL TABLE'));

    // Ordering: migration sequence → gist index → columns → FTS5
    expect(obsIdx).toBeLessThan(contentIdx);
    expect(gistIndexIdx).toBeLessThan(contentIdx);
    expect(contentIdx).toBeLessThan(ftsIdx);
  });
});
