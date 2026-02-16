/**
 * ublockImport-rulesBuilder.test.js
 * uBlock Import - RulesBuilderモジュールのユニットテスト
 */

import {
  rebuildRulesFromSources,
  previewUblockFilter
} from '../ublockImport.js';

describe('ublockImport - RulesBuilder Module', () => {
  // ============================================================================
  // rebuildRulesFromSources
  // ============================================================================

  describe('rebuildRulesFromSources', () => {
    test('空のソースリストでは空のルールを返す', () => {
      const result = rebuildRulesFromSources([]);
      expect(result.blockRules).toEqual([]);
      expect(result.exceptionRules).toEqual([]);
    });

    test('単一ソースのルールを再構築', () => {
      const sources = [
        {
          url: 'https://example.com/filters.txt',
          importedAt: Date.now(),
          ruleCount: 2,
          blockDomains: ['example.com', 'test.com'],
          exceptionDomains: []
        }
      ];

      const result = rebuildRulesFromSources(sources);
      expect(result.blockRules).toHaveLength(2);
      expect(result.exceptionRules).toHaveLength(0);
    });

    test('複数ソースのルールをマージ', () => {
      const sources = [
        {
          url: 'https://example.com/filters1.txt',
          importedAt: Date.now(),
          ruleCount: 2,
          blockDomains: ['example.com', 'test.com'],
          exceptionDomains: []
        },
        {
          url: 'https://example.com/filters2.txt',
          importedAt: Date.now(),
          ruleCount: 2,
          blockDomains: ['another.com', 'test.com'],
          exceptionDomains: ['trusted.com']
        }
      ];

      const result = rebuildRulesFromSources(sources);
      expect(result.blockRules).toHaveLength(3); // 重複除去
      expect(result.exceptionRules).toHaveLength(1);
    });

    test('重複するドメインをマージ', () => {
      const sources = [
        {
          url: 'https://example.com/filters1.txt',
          importedAt: Date.now(),
          ruleCount: 2,
          blockDomains: ['example.com', 'test.com'],
          exceptionDomains: []
        },
        {
          url: 'https://example.com/filters2.txt',
          importedAt: Date.now(),
          ruleCount: 2,
          blockDomains: ['example.com', 'test.com'],
          exceptionDomains: []
        }
      ];

      const result = rebuildRulesFromSources(sources);
      expect(result.blockRules).toHaveLength(2);
    });

    test('ワイルドカードドメインを処理', () => {
      const sources = [
        {
          url: 'https://example.com/filters.txt',
          importedAt: Date.now(),
          ruleCount: 2,
          blockDomains: ['*.example.com', 'sub.example.com'],
          exceptionDomains: []
        }
      ];

      const result = rebuildRulesFromSources(sources);
      expect(result.blockRules).toHaveLength(2);
      expect(result.blockRules).toContain('*.example.com');
    });

    test('null/undefinedソースを安全に処理', () => {
      expect(rebuildRulesFromSources(null)).toBeDefined();
      expect(rebuildRulesFromSources(undefined)).toBeDefined();
    });
  });

  // ============================================================================
  // previewUblockFilter
  // ============================================================================

  describe('previewUblockFilter', () => {
    test('有効なルールをプレビュー', () => {
      const filterText = '||example.com^\n||test.com^\n@@||trusted.com^';
      const result = previewUblockFilter(filterText);

      expect(result.blockCount).toBe(2);
      expect(result.exceptionCount).toBe(1);
      expect(result.errorCount).toBe(0);
      expect(result.errorDetails).toHaveLength(0);
    });

    test('エラーを含むルールをプレビュー', () => {
      const filterText = '||example.com^\ninvalid line\n||test.com^';
      const result = previewUblockFilter(filterText);

      expect(result.blockCount).toBe(2);
      expect(result.errorCount).toBeGreaterThan(0);
      expect(Array.isArray(result.errorDetails)).toBe(true);
    });

    test('空のフィルターテキストを処理', () => {
      const result = previewUblockFilter('');

      expect(result.blockCount).toBe(0);
      expect(result.exceptionCount).toBe(0);
      expect(result.errorCount).toBe(0);
    });

    test('コメントと空行をスキップ', () => {
      const filterText = '! Comment\n\n||example.com^\n';
      const result = previewUblockFilter(filterText);

      expect(result.blockCount).toBe(1);
      expect(result.errorCount).toBe(0);
    });

    test('null/undefinedを安全に処理', () => {
      expect(previewUblockFilter(null)).toBeDefined();
      expect(previewUblockFilter(undefined)).toBeDefined();
    });

    test('大量の有効なルールを処理', () => {
      const rules = Array(1000).fill(0).map((_, i) => `||domain${i}.com^`).join('\n');
      const result = previewUblockFilter(rules);

      expect(result.blockCount).toBe(1000);
      expect(result.errorCount).toBe(0);
    });

    test('hosts形式のルールを処理', () => {
      const filterText = '0.0.0.0 example.com\n127.0.0.1 test.com';
      const result = previewUblockFilter(filterText);

      expect(result.blockCount).toBeGreaterThan(0);
    });

    test('エラーメッセージが正しくフォーマットされる', () => {
      const filterText = '||example.com^\ninvalid rule without ^^';
      const result = previewUblockFilter(filterText);

      expect(result.errorCount).toBeGreaterThan(0);
      if (result.errorDetails.length > 0) {
        // errorDetails はオブジェクトの配列 { lineNumber, line, message }
        expect(typeof result.errorDetails[0]).toBe('object');
        expect(result.errorDetails[0]).toHaveProperty('lineNumber');
        expect(result.errorDetails[0]).toHaveProperty('line');
        expect(result.errorDetails[0]).toHaveProperty('message');
      }
    });
  });

  // ============================================================================
  // 統合テスト
  // ============================================================================

  describe('Integration Tests', () => {
    test('プレビューからルール再構築へのフロー', () => {
      const filterText = '||example.com^\n||test.com^\n@@||trusted.com^';
      const preview = previewUblockFilter(filterText);

      expect(preview.blockCount).toBe(2);
      expect(preview.exceptionCount).toBe(1);

      const sources = [
        {
          url: 'manual',
          importedAt: Date.now(),
          ruleCount: preview.blockCount + preview.exceptionCount,
          blockDomains: ['example.com', 'test.com'],
          exceptionDomains: ['trusted.com']
        }
      ];

      const result = rebuildRulesFromSources(sources);
      expect(result.blockRules).toHaveLength(2);
      expect(result.exceptionRules).toHaveLength(1);
    });
  });
});