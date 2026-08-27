/**
 * sqliteQueryBuilder-comprehensive.test.ts
 * Comprehensive tests for all SQL clause builder functions:
 * buildWhereClause, buildOrderByClause, buildFts5OrderClause,
 * buildLikeOrderClause, buildFtsTagMatchCondition, shouldUseFts5,
 * sanitizeTextForFts5, buildTagFilterClause.
 */

import { describe, it, expect } from 'vitest';
import {
  buildWhereClause,
  buildOrderByClause,
  buildFts5OrderClause,
  buildLikeOrderClause,
  buildFtsTagMatchCondition,
  shouldUseFts5,
  sanitizeTextForFts5,
  buildTagFilterClause,
} from '../sqliteQueryBuilder.js';

// ── buildWhereClause ───────────────────────────────────────────────────

describe('buildWhereClause', () => {
  it('defaults to is_deleted = 0 when excludeDeleted is not explicitly false', () => {
    const { where, params } = buildWhereClause({});
    expect(where).toContain('is_deleted = 0');
    expect(params).toEqual([]);
  });

  it('omits is_deleted filter when excludeDeleted is false', () => {
    const { where } = buildWhereClause({ excludeDeleted: false });
    expect(where).not.toContain('is_deleted');
  });

  it('adds dateFrom condition', () => {
    const { where, params } = buildWhereClause({ dateFrom: 1000 });
    expect(where).toContain('created_at >= ?');
    expect(params).toContain(1000);
  });

  it('adds dateTo condition', () => {
    const { where, params } = buildWhereClause({ dateTo: 2000 });
    expect(where).toContain('created_at <= ?');
    expect(params).toContain(2000);
  });

  it('adds both dateFrom and dateTo conditions', () => {
    const { where, params } = buildWhereClause({ dateFrom: 1000, dateTo: 2000 });
    expect(where).toContain('created_at >= ?');
    expect(where).toContain('created_at <= ?');
    expect(params).toEqual([1000, 2000]);
  });

  it('adds domain condition', () => {
    const { where, params } = buildWhereClause({ domain: 'example.com' });
    expect(where).toContain('domain = ?');
    expect(params).toContain('example.com');
  });

  it('adds starred condition (true -> is_starred = 1)', () => {
    const { where, params } = buildWhereClause({ starred: true });
    expect(where).toContain('is_starred = ?');
    expect(params).toContain(1);
  });

  it('adds starred condition (false -> is_starred = 0)', () => {
    const { where, params } = buildWhereClause({ starred: false });
    expect(where).toContain('is_starred = ?');
    expect(params).toContain(0);
  });

  it('adds gistSynced condition', () => {
    const { where, params } = buildWhereClause({ gistSynced: 1 });
    expect(where).toContain('gist_synced = ?');
    expect(params).toContain(1);
  });

  it('adds ids IN clause with correct placeholders', () => {
    const { where, params } = buildWhereClause({ ids: [1, 5, 99] });
    expect(where).toContain('id IN (?,?,?)');
    expect(params).toEqual([1, 5, 99]);
  });

  it('does not add ids clause for empty array', () => {
    const { where, params } = buildWhereClause({ ids: [] });
    expect(where).not.toContain('id IN');
    expect(params).toEqual([]);
  });

  it('combines multiple conditions with AND', () => {
    const { where } = buildWhereClause({
      domain: 'example.com',
      starred: true,
      dateFrom: 1000,
    });
    const parts = where.replace('WHERE ', '').split(' AND ');
    expect(parts.length).toBeGreaterThanOrEqual(4); // is_deleted + domain + starred + dateFrom
  });

  it('returns empty WHERE when excludeDeleted is false and no other filters', () => {
    const { where, params } = buildWhereClause({ excludeDeleted: false });
    expect(where).toBe('');
    expect(params).toEqual([]);
  });

  it('handles undefined/null values in query (ignores them)', () => {
    const { where, params } = buildWhereClause({
      domain: undefined,
      starred: null as unknown as boolean,
      dateFrom: undefined,
    });
    // Only is_deleted = 0
    expect(params).toEqual([]);
  });
});

// ── buildOrderByClause ─────────────────────────────────────────────────

describe('buildOrderByClause', () => {
  it('defaults to created_at DESC', () => {
    const { orderClause } = buildOrderByClause({});
    expect(orderClause).toBe('ORDER BY created_at DESC');
  });

  it('uses provided orderBy column', () => {
    const { orderClause } = buildOrderByClause({ orderBy: 'url' });
    expect(orderClause).toBe('ORDER BY url DESC');
  });

  it('uses provided orderDir ASC', () => {
    const { orderClause } = buildOrderByClause({ orderDir: 'ASC' });
    expect(orderClause).toBe('ORDER BY created_at ASC');
  });

  it('returns error for invalid orderBy column', () => {
    const { orderClause, error } = buildOrderByClause({ orderBy: 'DROP TABLE' as any });
    expect(orderClause).toBe('');
    expect(error).toContain('Invalid orderBy');
  });

  it('returns error for invalid orderDir', () => {
    const { orderClause, error } = buildOrderByClause({ orderDir: 'RANDOM' as any });
    expect(orderClause).toBe('');
    expect(error).toContain('Invalid orderDir');
  });

  it('treats rank as a valid orderBy but maps to created_at', () => {
    const { orderClause } = buildOrderByClause({ orderBy: 'rank' });
    expect(orderClause).toBe('ORDER BY created_at DESC');
  });

  it('handles all ALLOWED_ORDER_COLUMNS', () => {
    const allowedCols = [
      'id', 'url', 'title', 'summary', 'tags', 'created_at',
      'domain', 'visit_duration', 'scroll_ratio', 'is_starred', 'is_deleted',
    ];
    for (const col of allowedCols) {
      const { orderClause, error } = buildOrderByClause({ orderBy: col as any });
      expect(error).toBeUndefined();
      expect(orderClause).toContain(col);
    }
  });

  it('rejects SQL injection attempts in orderBy', () => {
    const injections = [
      '1; DROP TABLE',
      'created_at; --',
      'a OR b',
      'id UNION SELECT',
    ];
    for (const inj of injections) {
      const { error } = buildOrderByClause({ orderBy: inj as any });
      expect(error).toBeDefined();
    }
  });

  it('rejects SQL injection attempts in orderDir', () => {
    const { error } = buildOrderByClause({ orderDir: 'ASC; DROP TABLE' as any });
    expect(error).toBeDefined();
  });
});

// ── buildFts5OrderClause ───────────────────────────────────────────────

describe('buildFts5OrderClause', () => {
  it('defaults to rank for FTS5 results', () => {
    const { orderClause } = buildFts5OrderClause({});
    expect(orderClause).toBe('rank');
  });

  it('uses created_at with bidirectional sort when orderBy is created_at', () => {
    const { orderClause } = buildFts5OrderClause({ orderBy: 'created_at' });
    expect(orderClause).toContain('b.created_at');
    expect(orderClause).toContain('b.id');
  });

  it('uses ASC direction when orderDir is ASC', () => {
    const { orderClause } = buildFts5OrderClause({ orderBy: 'created_at', orderDir: 'ASC' });
    expect(orderClause).toContain('ASC');
  });

  it('returns error for invalid orderDir', () => {
    const { error } = buildFts5OrderClause({ orderDir: 'XSS' as any });
    expect(error).toContain('Invalid orderDir');
  });

  it('uses rank when orderBy is not created_at', () => {
    const { orderClause } = buildFts5OrderClause({ orderBy: 'url' as any });
    expect(orderClause).toBe('rank');
  });
});

// ── buildLikeOrderClause ───────────────────────────────────────────────

describe('buildLikeOrderClause', () => {
  it('defaults to created_at DESC', () => {
    const { orderClause } = buildLikeOrderClause({});
    expect(orderClause).toBe('created_at DESC');
  });

  it('uses created_at when orderBy is created_at', () => {
    const { orderClause } = buildLikeOrderClause({ orderBy: 'created_at', orderDir: 'ASC' });
    expect(orderClause).toBe('created_at ASC');
  });

  it('falls back to created_at DESC when orderBy is rank', () => {
    const { orderClause } = buildLikeOrderClause({ orderBy: 'rank' });
    expect(orderClause).toBe('created_at DESC');
  });

  it('returns error for invalid orderDir', () => {
    const { error } = buildLikeOrderClause({ orderDir: 'INVALID' as any });
    expect(error).toContain('Invalid orderDir');
  });
});

// ── buildFtsTagMatchCondition ──────────────────────────────────────────

describe('buildFtsTagMatchCondition', () => {
  it('builds a MATCH condition with # prefix', () => {
    const { condition, param } = buildFtsTagMatchCondition('programming');
    expect(condition).toContain('browsing_logs_fts');
    expect(condition).toContain('MATCH');
    expect(param).toBe('"#programming"');
  });

  it('strips FTS5 special characters from tag', () => {
    const { param } = buildFtsTagMatchCondition('test*~^');
    expect(param).not.toContain('*');
    expect(param).not.toContain('~');
    expect(param).not.toContain('^');
  });

  it('strips FTS5 operator keywords from tag', () => {
    const { param } = buildFtsTagMatchCondition('OR AND NOT NEAR');
    expect(param).not.toMatch(/\bOR\b/);
    expect(param).not.toMatch(/\bAND\b/);
  });

  it('truncates tag to FTS_QUERY_MAX_LENGTH', () => {
    const longTag = 'a'.repeat(300);
    const { param } = buildFtsTagMatchCondition(longTag);
    // sliced to 200, then wrapped as "\"#\" + 200 + \"\""
    expect(param.length).toBeLessThanOrEqual(200 + 3);
  });

  it('handles CJK tag names', () => {
    const { param } = buildFtsTagMatchCondition('日本語テスト');
    expect(param).toBe('"#日本語テスト"');
  });

  it('handles empty tag', () => {
    const { condition, param } = buildFtsTagMatchCondition('');
    expect(condition).toContain('MATCH');
    expect(param).toBe('"#"');
  });
});

// ── shouldUseFts5 ──────────────────────────────────────────────────────

describe('shouldUseFts5', () => {
  it('returns true when FTS5 is available and term has 3+ chars', () => {
    expect(shouldUseFts5(true, 'test')).toBe(true);
  });

  it('returns false when FTS5 is not available', () => {
    expect(shouldUseFts5(false, 'test')).toBe(false);
  });

  it('returns false when term has fewer than 3 chars', () => {
    expect(shouldUseFts5(true, 'ab')).toBe(false);
  });

  it('returns false for empty term', () => {
    expect(shouldUseFts5(true, '')).toBe(false);
  });

  it('returns true for exactly 3 chars', () => {
    expect(shouldUseFts5(true, 'abc')).toBe(true);
  });

  it('counts by Unicode code points, not UTF-16 code units', () => {
    // Japanese character is a single code point
    expect(shouldUseFts5(true, '日本語')).toBe(true);
    // 2 chars is below threshold
    expect(shouldUseFts5(true, '日本')).toBe(false);
  });
});

// ── sanitizeTextForFts5 ────────────────────────────────────────────────

describe('sanitizeTextForFts5', () => {
  it('delegates to sanitizeFtsTerm', () => {
    expect(sanitizeTextForFts5('test')).toBe('test');
    expect(sanitizeTextForFts5('')).toBe('');
  });

  it('strips FTS5 operator words', () => {
    expect(sanitizeTextForFts5('foo OR bar')).toBe('foo bar');
  });
});

// ── buildTagFilterClause ───────────────────────────────────────────────

describe('buildTagFilterClause', () => {
  it('returns LIKE clause with # prefix', () => {
    const { tagCondition, tagParam } = buildTagFilterClause();
    expect(tagCondition).toBe('tags LIKE ?');
    expect(tagParam).toBe('#%');
  });
});
