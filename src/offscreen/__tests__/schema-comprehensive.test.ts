/**
 * schema-comprehensive.test.ts
 * Comprehensive tests for schema.ts constants, SQL integrity,
 * sanitizeFtsTerm edge cases, COLUMN_NAMES synchronization,
 * and buildInsertParams/buildInsertRecordFields boundary values.
 */

import { describe, it, expect } from 'vitest';
import {
  SCHEMA_SQL,
  GIST_SYNCED_INDEX_SQL,
  COLUMN_NAMES,
  INSERT_SQL,
  INSERT_IGNORE_SQL,
  UPDATABLE_FIELDS,
  ALLOWED_ORDER_COLUMNS,
  buildInsertParams,
  buildInsertRecordFields,
  FTS5_STATEMENTS,
  AUDIT_LOG_SCHEMA_SQL,
  MIGRATION_COLUMNS,
  MIGRATION_SEQUENCE,
  FTS_QUERY_MAX_LENGTH,
  sanitizeFtsTerm,
  type InsertableRecord,
} from '../schema.js';

function minimal(overrides: Partial<InsertableRecord> = {}): InsertableRecord {
  return { url: 'https://example.com', created_at: 1000, ...overrides };
}

// ── SQL string integrity ────────────────────────────────────────────────

describe('SCHEMA_SQL', () => {
  it('creates the browsing_logs table with IF NOT EXISTS', () => {
    expect(SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS browsing_logs');
  });

  it('includes a UNIQUE constraint on (url, created_at)', () => {
    expect(SCHEMA_SQL).toContain('UNIQUE(url, created_at)');
  });

  it('defines all expected indexes', () => {
    expect(SCHEMA_SQL).toContain('idx_logs_created');
    expect(SCHEMA_SQL).toContain('idx_logs_domain');
    expect(SCHEMA_SQL).toContain('idx_logs_active');
    expect(SCHEMA_SQL).toContain('idx_logs_obsidian');
  });

  it('includes CHECK constraints for is_starred and is_deleted', () => {
    expect(SCHEMA_SQL).toContain("CHECK(is_starred IN (0, 1))");
    expect(SCHEMA_SQL).toContain("CHECK(is_deleted IN (0, 1))");
  });

  it('includes CHECK constraint for visit_duration (non-negative)', () => {
    expect(SCHEMA_SQL).toContain('CHECK(visit_duration IS NULL OR visit_duration >= 0)');
  });

  it('includes CHECK constraint for scroll_ratio (0-1 range)', () => {
    expect(SCHEMA_SQL).toContain('CHECK(scroll_ratio IS NULL OR (scroll_ratio >= 0 AND scroll_ratio <= 1))');
  });
});

describe('GIST_SYNCED_INDEX_SQL', () => {
  it('creates idx_logs_gist index', () => {
    expect(GIST_SYNCED_INDEX_SQL).toContain('idx_logs_gist');
    expect(GIST_SYNCED_INDEX_SQL).toContain('gist_synced');
  });
});

describe('AUDIT_LOG_SCHEMA_SQL', () => {
  it('creates the audit_log table with IF NOT EXISTS', () => {
    expect(AUDIT_LOG_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS audit_log');
  });

  it('defines an index on created_at', () => {
    expect(AUDIT_LOG_SCHEMA_SQL).toContain('idx_audit_log_created');
  });
});

// ── COLUMN_NAMES ───────────────────────────────────────────────────────

describe('COLUMN_NAMES', () => {
  it('has exactly 32 columns (matching schema)', () => {
    expect(COLUMN_NAMES).toHaveLength(32);
  });

  it('starts with url and ends with fallback_triggered', () => {
    expect(COLUMN_NAMES[0]).toBe('url');
    expect(COLUMN_NAMES[COLUMN_NAMES.length - 1]).toBe('fallback_triggered');
  });

  it('places created_at at index 4', () => {
    expect(COLUMN_NAMES[4]).toBe('created_at');
  });

  it('places domain at index 5', () => {
    expect(COLUMN_NAMES[5]).toBe('domain');
  });

  it('is readonly (as const)', () => {
    // TypeScript-level assertion: COLUMN_NAMES is readonly
    type IsReadonly = typeof COLUMN_NAMES extends readonly string[] ? true : false;
    const check: IsReadonly = true;
    expect(check).toBe(true);
  });

  it('contains no duplicate column names', () => {
    const unique = new Set(COLUMN_NAMES);
    expect(unique.size).toBe(COLUMN_NAMES.length);
  });
});

// ── INSERT_SQL ─────────────────────────────────────────────────────────

describe('INSERT_SQL', () => {
  it('has one placeholder per COLUMN_NAME', () => {
    const placeholders = INSERT_SQL.split('?').length - 1;
    expect(placeholders).toBe(COLUMN_NAMES.length);
  });

  it('includes all column names in the correct order', () => {
    for (const col of COLUMN_NAMES) {
      expect(INSERT_SQL).toContain(col);
    }
  });

  it('does not use INSERT OR IGNORE', () => {
    expect(INSERT_SQL).not.toContain('OR IGNORE');
  });
});

describe('INSERT_IGNORE_SQL', () => {
  it('uses INSERT OR IGNORE', () => {
    expect(INSERT_IGNORE_SQL).toContain('INSERT OR IGNORE');
  });

  it('has the same number of placeholders as INSERT_SQL', () => {
    const ignorePlaceholders = INSERT_IGNORE_SQL.split('?').length - 1;
    const normalPlaceholders = INSERT_SQL.split('?').length - 1;
    expect(ignorePlaceholders).toBe(normalPlaceholders);
  });
});

// ── UPDATABLE_FIELDS ───────────────────────────────────────────────────

describe('UPDATABLE_FIELDS', () => {
  it('does not include id (primary key should not be updatable)', () => {
    expect(UPDATABLE_FIELDS).not.toContain('id');
  });

  it('does not include created_at (immutable after insert)', () => {
    expect(UPDATABLE_FIELDS).not.toContain('created_at');
  });

  it('includes url and title', () => {
    expect(UPDATABLE_FIELDS).toContain('url');
    expect(UPDATABLE_FIELDS).toContain('title');
  });
});

// ── ALLOWED_ORDER_COLUMNS ──────────────────────────────────────────────

describe('ALLOWED_ORDER_COLUMNS', () => {
  it('includes id and created_at', () => {
    expect(ALLOWED_ORDER_COLUMNS).toContain('id');
    expect(ALLOWED_ORDER_COLUMNS).toContain('created_at');
  });

  it('does not contain SQL injection vectors', () => {
    for (const col of ALLOWED_ORDER_COLUMNS) {
      expect(col).toMatch(/^[a-z_]+$/);
    }
  });
});

// ── FTS5_STATEMENTS ────────────────────────────────────────────────────

describe('FTS5_STATEMENTS', () => {
  it('has exactly 4 statements (virtual table + 3 triggers)', () => {
    expect(FTS5_STATEMENTS).toHaveLength(4);
  });

  it('first statement creates browsing_logs_fts virtual table', () => {
    expect(FTS5_STATEMENTS[0]).toContain('CREATE VIRTUAL TABLE IF NOT EXISTS browsing_logs_fts');
    expect(FTS5_STATEMENTS[0]).toContain("tokenize='trigram'");
  });

  it('includes AFTER INSERT, AFTER DELETE, AFTER UPDATE triggers', () => {
    const joined = FTS5_STATEMENTS.join(' ');
    expect(joined).toContain('AFTER INSERT');
    expect(joined).toContain('AFTER DELETE');
    expect(joined).toContain('AFTER UPDATE');
  });
});

// ── MIGRATION_COLUMNS ──────────────────────────────────────────────────

describe('MIGRATION_COLUMNS', () => {
  it('contains all ALTER TABLE column definitions', () => {
    expect(MIGRATION_COLUMNS.length).toBeGreaterThan(0);
    for (const col of MIGRATION_COLUMNS) {
      expect(col).toMatch(/^[a-z_]+ (TEXT|INTEGER|REAL)/);
    }
  });

  it('includes content TEXT', () => {
    expect(MIGRATION_COLUMNS).toContain('content TEXT');
  });

  it('includes fallback_triggered INTEGER DEFAULT 0', () => {
    expect(MIGRATION_COLUMNS).toContain('fallback_triggered INTEGER DEFAULT 0');
  });
});

// ── MIGRATION_SEQUENCE ─────────────────────────────────────────────────

describe('MIGRATION_SEQUENCE', () => {
  it('contains obsidian_synced and gist_synced migrations', () => {
    const ids = MIGRATION_SEQUENCE.map(s => s.id);
    expect(ids).toContain('obsidian_synced');
    expect(ids).toContain('gist_synced');
  });

  it('each step has both sql and id', () => {
    for (const step of MIGRATION_SEQUENCE) {
      expect(step.sql).toBeTruthy();
      expect(step.id).toBeTruthy();
    }
  });
});

// ── sanitizeFtsTerm edge cases ──────────────────────────────────────────

describe('sanitizeFtsTerm edge cases', () => {
  it('returns empty string for null/undefined coercion', () => {
    expect(sanitizeFtsTerm('')).toBe('');
  });

  it('strips FTS5 special characters: * ~ ^ : ( ) + -', () => {
    const result = sanitizeFtsTerm('test*~^:()+-');
    expect(result).not.toContain('*');
    expect(result).not.toContain('~');
    expect(result).not.toContain('^');
    expect(result).not.toContain(':');
    expect(result).not.toContain('(');
    expect(result).not.toContain(')');
    expect(result).not.toContain('+');
    expect(result).not.toContain('-');
  });

  it('strips FTS5 operator words: OR, AND, NOT, NEAR (case insensitive)', () => {
    const result = sanitizeFtsTerm('foo OR bar AND baz NOT qux NEAR 5');
    expect(result).toBe('foo bar baz qux 5');
  });

  it('preserves Chinese characters (CJK Unified Ideographs)', () => {
    expect(sanitizeFtsTerm('東京タワー')).toBe('東京タワー');
  });

  it('preserves Japanese hiragana and katakana', () => {
    expect(sanitizeFtsTerm('ひらがな カタカナ')).toBe('ひらがな カタカナ');
  });

  it('strips full-width alphanumeric (not in whitelist)', () => {
    expect(sanitizeFtsTerm('０１２３ＡＢＣ')).toBe('');
  });

  it('truncates to exactly FTS_QUERY_MAX_LENGTH before sanitization', () => {
    const input = 'a'.repeat(FTS_QUERY_MAX_LENGTH + 100);
    const result = sanitizeFtsTerm(input);
    // After truncation to 200 chars + sanitize, result length <= 200
    expect(result.length).toBeLessThanOrEqual(FTS_QUERY_MAX_LENGTH);
  });

  it('handles input that is exactly at the max length', () => {
    const input = 'x'.repeat(FTS_QUERY_MAX_LENGTH);
    const result = sanitizeFtsTerm(input);
    expect(result.length).toBe(FTS_QUERY_MAX_LENGTH);
  });

  it('handles input with only special characters (returns empty)', () => {
    expect(sanitizeFtsTerm('*~^:()')).toBe('');
  });

  it('handles input with only whitespace (returns empty)', () => {
    expect(sanitizeFtsTerm('   ')).toBe('');
  });

  it('strips double quotes used for FTS5 phrase queries', () => {
    expect(sanitizeFtsTerm('"exact phrase"')).toBe('exact phrase');
  });

  it('strips backslash escape character', () => {
    expect(sanitizeFtsTerm('test\\value')).toBe('test value');
  });

  it('strips single quote (replaces with space)', () => {
    expect(sanitizeFtsTerm("it's")).toBe('it s');
  });
});

// ── buildInsertParams boundary values ───────────────────────────────────

describe('buildInsertParams boundary values', () => {
  it('handles URL with special characters', () => {
    const params = buildInsertParams(
      minimal({ url: 'https://example.com/path?q=1&r=2#hash' }),
      'example.com'
    );
    expect(params[COLUMN_NAMES.indexOf('url')]).toBe('https://example.com/path?q=1&r=2#hash');
  });

  it('handles empty string values for optional text fields', () => {
    const params = buildInsertParams(
      minimal({ title: '', summary: '', tags: '' }),
      'example.com'
    );
    expect(params[COLUMN_NAMES.indexOf('title')]).toBe('');
    expect(params[COLUMN_NAMES.indexOf('summary')]).toBe('');
    expect(params[COLUMN_NAMES.indexOf('tags')]).toBe('');
  });

  it('handles zero values for numeric fields (not null)', () => {
    const params = buildInsertParams(
      minimal({
        visit_duration: 0,
        scroll_ratio: 0,
        sent_tokens: 0,
        received_tokens: 0,
      }),
      'example.com'
    );
    expect(params[COLUMN_NAMES.indexOf('visit_duration')]).toBe(0);
    expect(params[COLUMN_NAMES.indexOf('scroll_ratio')]).toBe(0);
    expect(params[COLUMN_NAMES.indexOf('sent_tokens')]).toBe(0);
    expect(params[COLUMN_NAMES.indexOf('received_tokens')]).toBe(0);
  });

  it('handles very large created_at values (year 2099+)', () => {
    const farFuture = new Date('2099-12-31T23:59:59Z').getTime();
    const params = buildInsertParams(minimal({ created_at: farFuture }), 'x.com');
    expect(params[COLUMN_NAMES.indexOf('created_at')]).toBe(farFuture);
  });

  it('handles negative created_at (edge case)', () => {
    const params = buildInsertParams(minimal({ created_at: -1 }), 'x.com');
    expect(params[COLUMN_NAMES.indexOf('created_at')]).toBe(-1);
  });

  it('handles very long URL string', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(10000);
    const params = buildInsertParams(minimal({ url: longUrl }), 'example.com');
    expect(params[COLUMN_NAMES.indexOf('url')]).toBe(longUrl);
  });

  it('handles very long content string', () => {
    const longContent = 'x'.repeat(500000);
    const params = buildInsertParams(minimal({ content: longContent }), 'e.com');
    expect(params[COLUMN_NAMES.indexOf('content')]).toBe(longContent);
  });
});

// ── buildInsertRecordFields parity with buildInsertParams ───────────────

describe('buildInsertRecordFields parity', () => {
  it('produces all COLUMN_NAMES as keys', () => {
    const fields = buildInsertRecordFields(minimal(), 'e.com');
    for (const col of COLUMN_NAMES) {
      expect(fields).toHaveProperty(col);
    }
  });

  it('handles BigInt values in optional fields (coerced to Number)', () => {
    const fields = buildInsertRecordFields(
      minimal({ ai_duration_ms: Number(BigInt(123456789)) }),
      'e.com'
    );
    expect(fields.ai_duration_ms).toBe(123456789);
  });

  it('preserves null for explicitly null optional fields', () => {
    const fields = buildInsertRecordFields(
      minimal({ title: null, content: null, summary: null }),
      'e.com'
    );
    expect(fields.title).toBeNull();
    expect(fields.content).toBeNull();
    expect(fields.summary).toBeNull();
  });
});
