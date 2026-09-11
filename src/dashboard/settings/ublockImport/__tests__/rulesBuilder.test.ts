// @vitest-environment jsdom
/**
 * ublockImport-rulesBuilder.test.js
 * uBlock Import - RulesBuilderモジュールのユニットテスト
 */

import {
  rebuildRulesFromSources,
  previewUblockFilter
} from '../index.js';

describe('ublockImport - RulesBuilder Module', () => {
  // ============================================================================
  // rebuildRulesFromSources
  // ============================================================================

  describe('rebuildRulesFromSources', () => {
    test('returns empty rules for an empty source list', () => {
      const result = rebuildRulesFromSources([]);
      expect(result.blockRules).toEqual([]);
      expect(result.exceptionRules).toEqual([]);
    });

    test('rebuilds rules from a single source', () => {
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

    test('merges rules from multiple sources', () => {
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

    test('merges duplicate domains', () => {
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

    test('handles wildcard domains', () => {
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

    test('handles null/undefined sources safely', () => {
      expect(rebuildRulesFromSources(null as unknown as Parameters<typeof rebuildRulesFromSources>[0])).toBeDefined();
      expect(rebuildRulesFromSources(undefined as unknown as Parameters<typeof rebuildRulesFromSources>[0])).toBeDefined();
    });
  });

  // ============================================================================
  // previewUblockFilter
  // ============================================================================

  describe('previewUblockFilter', () => {
    test('previews valid rules', () => {
      const filterText = '||example.com^\n||test.com^\n@@||trusted.com^';
      const result = previewUblockFilter(filterText);

      expect(result.blockCount).toBe(2);
      expect(result.exceptionCount).toBe(1);
      expect(result.errorCount).toBe(0);
      expect(result.errorDetails).toHaveLength(0);
    });

    test('previews rules containing errors', () => {
      const filterText = '||example.com^\ninvalid line\n||test.com^';
      const result = previewUblockFilter(filterText);

      expect(result.blockCount).toBe(2);
      expect(result.errorCount).toBeGreaterThan(0);
      expect(Array.isArray(result.errorDetails)).toBe(true);
    });

    test('handles empty filter text', () => {
      const result = previewUblockFilter('');

      expect(result.blockCount).toBe(0);
      expect(result.exceptionCount).toBe(0);
      expect(result.errorCount).toBe(0);
    });

    test('skips comments and empty lines', () => {
      const filterText = '! Comment\n\n||example.com^\n';
      const result = previewUblockFilter(filterText);

      expect(result.blockCount).toBe(1);
      expect(result.errorCount).toBe(0);
    });

    test('handles null/undefined safely', () => {
      expect(previewUblockFilter(null as unknown as string)).toBeDefined();
      expect(previewUblockFilter(undefined as unknown as string)).toBeDefined();
    });

    test('handles a large number of valid rules', () => {
      const rules = Array(1000).fill(0).map((_, i) => `||domain${i}.com^`).join('\n');
      const result = previewUblockFilter(rules);

      expect(result.blockCount).toBe(1000);
      expect(result.errorCount).toBe(0);
    });

    test('handles hosts-format rules', () => {
      const filterText = '0.0.0.0 example.com\n127.0.0.1 test.com';
      const result = previewUblockFilter(filterText);

      expect(result.blockCount).toBeGreaterThan(0);
    });

    test('formats error messages correctly', () => {
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
    test('flows from preview to rule rebuild', () => {
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