/**
 * check-dependings.test.ts
 * Unit tests for the pure helpers in scripts/release-checks/check-dependings.mjs.
 */
import { describe, it, expect } from 'vitest';
import {
  parseRuntimeTable,
  parseDevGroupVersions,
  parseCounts,
  parseFinalCheckDate,
  parseNoticesCount,
  parseDocNoticesCount,
  compareRuntime,
  compareDevVersions,
  compareCounts,
  decideDateFreshness,
} from '../release-checks/check-dependings.mjs';

const DOC = [
  '- 最終確認日: 2026-11-26',
  '- ランタイム依存（配布物に同梱）: 2 件のみ',
  '- 開発依存: 29 件',
  '- lockfile 上のパッケージ総数: 938（うち `node_modules` に実インストールされてライセンス走査の対象になるのは 744）',
  '| パッケージ | 要求バージョン | インストール済み |',
  '| `@subframe7536/sqlite-wasm` | ~1.4.1 | 1.4.1 |',
  '| ビルド | `wxt` (0.21.5), `vite` (8.3.8) |',
  '最終生成は 2026-11-26（744 パッケージ分）で、現在の 744 パッケージと一致',
].join('\n');

describe('check-dependings', () => {
  describe('parseRuntimeTable', () => {
    it('extracts required and installed versions per package', () => {
      const rows = parseRuntimeTable(DOC);
      expect(rows.get('@subframe7536/sqlite-wasm')).toEqual({ required: '~1.4.1', installed: '1.4.1' });
    });
  });

  describe('parseDevGroupVersions', () => {
    it('extracts versions from the dev-group table', () => {
      const versions = parseDevGroupVersions(DOC);
      expect(versions.get('wxt')).toBe('0.21.5');
      expect(versions.get('vite')).toBe('8.3.8');
    });
  });

  describe('parseCounts', () => {
    it('extracts dependency counts', () => {
      expect(parseCounts(DOC)).toEqual({ devDeps: 29, lockTotal: 938, licenseTargets: 744, runtimeCount: 2 });
    });
  });

  describe('parseFinalCheckDate', () => {
    it('extracts the header date', () => {
      expect(parseFinalCheckDate(DOC)).toBe('2026-11-26');
    });
  });

  describe('parseNoticesCount', () => {
    it('extracts the generated package count', () => {
      expect(parseNoticesCount('automatically generated for 744 package(s)')).toBe(744);
    });
  });

  describe('parseDocNoticesCount', () => {
    it('extracts the count recorded in the doc', () => {
      expect(parseDocNoticesCount(DOC)).toBe(744);
    });
  });

  describe('compareRuntime', () => {
    it('reports no mismatch when doc matches manifests', () => {
      const rows = parseRuntimeTable(DOC);
      const mismatches = compareRuntime(rows, { '@subframe7536/sqlite-wasm': '~1.4.1' }, {
        'node_modules/@subframe7536/sqlite-wasm': { version: '1.4.1' },
      });
      expect(mismatches).toEqual([]);
    });

    it('reports a mismatch when the installed version drifts', () => {
      const rows = parseRuntimeTable(DOC);
      const mismatches = compareRuntime(rows, { '@subframe7536/sqlite-wasm': '~1.4.1' }, {
        'node_modules/@subframe7536/sqlite-wasm': { version: '1.4.2' },
      });
      expect(mismatches).toHaveLength(1);
      expect(mismatches[0]).toContain('1.4.2');
    });
  });

  describe('compareDevVersions', () => {
    it('reports no mismatch when doc matches lockfile', () => {
      const mismatches = compareDevVersions(new Map([['wxt', '0.21.5']]), {
        'node_modules/wxt': { version: '0.21.5' },
      });
      expect(mismatches).toEqual([]);
    });

    it('reports a mismatch when the lockfile moved on', () => {
      const mismatches = compareDevVersions(new Map([['wxt', '0.21.5']]), {
        'node_modules/wxt': { version: '0.21.6' },
      });
      expect(mismatches).toHaveLength(1);
    });
  });

  describe('compareCounts', () => {
    it('reports no mismatch when counts agree', () => {
      const mismatches = compareCounts(
        { devDeps: 29, lockTotal: 938, licenseTargets: 744, runtimeCount: 2 },
        { devDeps: 29, lockTotal: 938, noticesCount: 744, docNoticesCount: 744, runtimeCount: 2 }
      );
      expect(mismatches).toEqual([]);
    });

    it('reports each drifted count', () => {
      const mismatches = compareCounts(
        { devDeps: 28, lockTotal: 938, licenseTargets: 744, runtimeCount: 2 },
        { devDeps: 29, lockTotal: 938, noticesCount: 744, docNoticesCount: 744, runtimeCount: 2 }
      );
      expect(mismatches).toHaveLength(1);
      expect(mismatches[0]).toContain('devDeps');
    });
  });

  describe('decideDateFreshness', () => {
    it('marks a current doc as fresh', () => {
      const verdict = decideDateFreshness('2026-11-26', new Date('2026-11-26T12:00:00'), 100, 50);
      expect(verdict.status).toBe('fresh');
    });

    it('marks a doc older than the lockfile as stale', () => {
      const verdict = decideDateFreshness('2026-11-26', new Date('2026-11-26T12:00:00'), 50, 100);
      expect(verdict.status).toBe('stale');
    });
  });
});
