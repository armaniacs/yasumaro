import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import { QUERY_CAPS } from '../../utils/limits.js';
import {
  buildAuditLogPurgeStatements,
  buildContentPurgeStatements,
  buildExtraWhereSql,
  buildFtsSearchStatements,
  buildLikeSearchStatements,
  buildPurgeOldRecordsStatements,
  buildQuerySpec,
  contentPurgeStarredClause,
  purgeCutoffMs,
  type AlreadyCappedQuery,
} from '../queryPlan.js';
import { applyReadPolicy } from '../queryPlanner.js';

/**
 * queryPlan-split-golden.test.ts (PBI 2026-11-07-07)
 *
 * TDD golden for the policy-vs-statement split:
 * - "output parity" pins the CURRENT SQL/limit/offset/params outputs BEFORE
 *   the split; after the split the diff must be zero. All imports use the
 *   public `queryPlan.js` paths, so the file itself survives the split
 *   unchanged (compat shims keep every path working).
 * - "plan-layer purity" asserts the post-split end state: no
 *   `withTransaction` / `rowMatchesTagLike` runtime refs in queryPlan.ts.
 *   RED before the split, GREEN after — that is the point.
 * - "worker-boundary casts" pins the 3 documented
 *   `as unknown as AlreadyCappedQuery` sites (hologue-1107 concern 3): a 4th
 *   site turns this red instead of slipping in silently.
 */
describe('queryPlan split golden', () => {
  describe('output parity (pinned before the split, zero diff after)', () => {
    it('pins the plain-listing QuerySpec', () => {
      const capped = applyReadPolicy({ domain: 'example.com', limit: 10 });
      const spec = buildQuerySpec(capped);
      expect(spec.where).toBe('WHERE is_deleted = 0 AND domain = ?');
      expect(spec.order).toBe('ORDER BY created_at DESC');
      expect(spec.limit).toBe(10);
      expect(spec.offset).toBe(0);
      expect(spec.params).toEqual(['example.com']);
      expect(spec.useFts).toBe(false);
      expect(spec.mode).toBe('listing');
      expect(spec.tagFilter).toBeNull();
      expect(spec.bareText).toBeNull();
    });

    it('pins the FTS search QuerySpec', () => {
      const capped: AlreadyCappedQuery = applyReadPolicy({ text: 'hello', limit: 5 });
      const spec = buildQuerySpec(capped, { fts5Available: true });
      expect(spec.useFts).toBe(true);
      expect(spec.mode).toBe('search');
      expect(spec.bareText).toBe('hello');
      expect(spec.limit).toBe(5);
      expect(spec.cap).toBe(QUERY_CAPS);
      expect(spec.where).toBe('WHERE is_deleted = 0');
    });

    it('pins the defensive re-clamp at the worker boundary', () => {
      // applyReadPolicy caps at MAX_QUERY_LIMIT (100k); buildQuerySpec
      // re-clamps to the path cap (plain 10k / fts 100k).
      const capped = applyReadPolicy({ limit: 1e9 });
      expect(buildQuerySpec(capped).limit).toBe(QUERY_CAPS.plain);
      const search = applyReadPolicy({ text: 'hello', limit: 1e9 });
      expect(buildQuerySpec(search, { fts5Available: true }).limit).toBe(QUERY_CAPS.fts);
    });

    it('pins the FTS search statements text and param order', () => {
      const extra = buildExtraWhereSql({ domain: 'example.com' });
      expect(extra.extraWhereSql).toBe(' AND domain = ?');
      expect(extra.includeDeletedFilter).toBe(true);
      const stmts = buildFtsSearchStatements(extra, {
        ftsQuery: '"hello"',
        orderClause: 'rank',
        limit: 10,
        offset: 5,
      });
      expect(stmts.countSql).toBe(
        'SELECT COUNT(*) AS c FROM browsing_logs_fts JOIN browsing_logs b ON browsing_logs_fts.rowid = b.id' +
          ' WHERE browsing_logs_fts MATCH ? AND b.is_deleted = 0 AND domain = ?',
      );
      expect(stmts.rowsSql).toBe(
        'SELECT b.id, b.url, b.title, b.summary, b.tags, b.created_at, b.domain, b.visit_duration, b.scroll_ratio, b.is_starred, b.fallback_reason, rank AS rank' +
          ' FROM browsing_logs_fts JOIN browsing_logs b ON browsing_logs_fts.rowid = b.id' +
          ' WHERE browsing_logs_fts MATCH ? AND b.is_deleted = 0 AND domain = ? ORDER BY rank LIMIT ? OFFSET ?',
      );
      expect(stmts.countParams).toEqual(['"hello"', 'example.com']);
      expect(stmts.rowsParams).toEqual(['"hello"', 'example.com', 10, 5]);
    });

    it('pins the LIKE search statements text and param order', () => {
      const extra = buildExtraWhereSql({ domain: 'example.com' });
      const stmts = buildLikeSearchStatements(extra, {
        likePattern: '%hello%',
        orderClause: 'created_at DESC',
        limit: 10,
        offset: 0,
      });
      expect(stmts.countSql).toBe(
        'SELECT COUNT(*) AS c FROM browsing_logs' +
          ' WHERE is_deleted = 0 AND (url LIKE ? OR title LIKE ? OR summary LIKE ? OR tags LIKE ?) AND domain = ?',
      );
      expect(stmts.rowsSql).toContain('ORDER BY created_at DESC LIMIT ? OFFSET ?');
      expect(stmts.countParams).toEqual(['%hello%', '%hello%', '%hello%', '%hello%', 'example.com']);
      expect(stmts.rowsParams).toEqual(['%hello%', '%hello%', '%hello%', '%hello%', 'example.com', 10, 0]);
    });

    it('pins the purge statement builders byte-for-byte', () => {
      expect(buildPurgeOldRecordsStatements()).toEqual({
        deleteOldSql: 'DELETE FROM browsing_logs WHERE created_at < ? AND is_starred = 0 AND is_deleted = 0',
        countSql: 'SELECT COUNT(*) AS c FROM browsing_logs WHERE is_deleted = 0',
        deleteExcessSql:
          'DELETE FROM browsing_logs WHERE id IN (' +
          'SELECT id FROM browsing_logs WHERE is_starred = 0 AND is_deleted = 0 ' +
          'ORDER BY created_at ASC LIMIT ?)',
      });
      expect(purgeCutoffMs(7, 1_000_000_000_000)).toBe(1_000_000_000_000 - 7 * 24 * 60 * 60 * 1000);
      expect(contentPurgeStarredClause(false)).toBe('AND is_starred = 0');
      expect(contentPurgeStarredClause(true)).toBe('');
      const content = buildContentPurgeStatements(contentPurgeStarredClause(false));
      expect(content.deleteOldSql).toContain('UPDATE browsing_logs SET content = NULL');
      expect(content.deleteOldSql).toContain('AND is_starred = 0');
      expect(buildAuditLogPurgeStatements(123)).toEqual({
        deleteOldSql: 'DELETE FROM audit_log WHERE created_at < ?',
        deleteOldParams: [123],
      });
    });
  });

  describe('plan-layer purity (post-split end state)', () => {
    const planSource = fs.readFileSync(new URL('../queryPlan.ts', import.meta.url), 'utf8');
    // Doc comments may name the banished symbols to document the split;
    // strip comments (and thus doc prose) so the pin targets real code refs.
    const codeOnly = planSource
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '$1');
    // The compat facade (`export { ... } from './sqliteQueryBuilder.js'`) is
    // explicitly allowed by the PBI — strip it so the pin targets what the
    // policy module itself defines, imports, and executes.
    const withoutFacade = codeOnly.replace(/export\s*\{[^}]*\}\s*from\s*['"][^'"]+['"]\s*;?/g, '');

    it('holds no withTransaction import or execution', () => {
      expect(codeOnly).not.toMatch(/sqliteTransaction\.js/);
      expect(withoutFacade).not.toMatch(/\bwithTransaction\b/);
      expect(withoutFacade).not.toMatch(/\brunPurgeSequence\b/);
    });

    it('holds no rowMatchesTagLike import or re-export', () => {
      expect(codeOnly).not.toMatch(/tagLike\.js/);
      expect(codeOnly).not.toMatch(/\browMatchesTagLike\b/);
    });
  });

  describe('worker-boundary casts (hologistic-1107 concern 3 pin)', () => {
    it('keeps exactly the 3 documented as unknown as AlreadyCappedQuery sites', () => {
      const sites = [
        'src/offscreen/IdbVfsBackend.ts',
        'src/offscreen/opfsWorker/crudHandlers.ts',
        'src/offscreen/storageFallback.ts',
      ];
      const root = new URL('../../../', import.meta.url);
      let total = 0;
      for (const site of sites) {
        const text = fs.readFileSync(new URL(site, root), 'utf8');
        const count = text.split('as unknown as AlreadyCappedQuery').length - 1;
        expect(`${site}: ${count}`).toBe(`${site}: 1`);
        total += count;
      }
      expect(total).toBe(3);
    });
  });
});
