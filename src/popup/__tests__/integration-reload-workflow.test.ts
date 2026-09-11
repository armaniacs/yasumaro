// @vitest-environment jsdom
/**
 * 統合テスト: ソースリロードワークフロー
 */

import { parseUblockFilterListWithErrors } from '../../utils/ublockParser/index.js';
import { rebuildRulesFromSources } from '../../dashboard/settings/ublockImport/index.js';
import { StorageKeys } from '../../utils/storage/types.js';

// モックの設定
global.fetch = vi.fn();
global.chrome = {
  storage: { local: { get: vi.fn(), set: vi.fn() } },
  runtime: { lastError: null },
} as unknown as typeof chrome;

describe('フローワーク: URLからインポートしてソースを再読み込み', () => {
  const mockFilterText = `
||example.com^
@@||safe.com^
`;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('fetches a filter list from a URL and parses it', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue
  
    global.fetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'text/plain' },
      text: () => Promise.resolve(mockFilterText)
    });

    const response = await fetch('https://example.com/filters.txt');
    const text = await response.text();

    const result = parseUblockFilterListWithErrors(text);

    expect(result.rules.blockRules.length).toBe(1);
    expect(result.rules.exceptionRules.length).toBe(1);
    expect(result.errors.length).toBe(0);
  });

  test('rebuilds rules from multiple sources', () => {
    const multiSources = [
      { blockDomains: ['example.com'], exceptionDomains: [] },
      { blockDomains: ['test.com'], exceptionDomains: ['safe.com'] }
    ];

    const merged = rebuildRulesFromSources(multiSources);

    expect(new Set(merged.blockDomains)).toEqual(new Set(['example.com', 'test.com']));
    expect(new Set(merged.exceptionDomains)).toEqual(new Set(['safe.com']));
  });

  test('reports invalid lines as errors (domain rules without a suffix are invalid)', () => {
    const mixedFilterText = `
||example.com
invalid line without caret
@@||safe.com^
`;

    const result = parseUblockFilterListWithErrors(mixedFilterText);

    expect(result.errors.length).toBeGreaterThan(0); // 無効なルールがエラーとして報告される
    expect(result.rules.blockRules.length).toBe(0); // ||example.comがないため（サフィックス^がない）
    expect(result.rules.exceptionRules.length).toBe(1); // @@||safe.com^は有効
  });

  test('handles an empty filter list', () => {
    const emptyFilterText = `
# Only comments here
!
! Another comment
`;

    const result = parseUblockFilterListWithErrors(emptyFilterText);

    expect(result.rules.blockRules.length).toBe(0);
    expect(result.rules.exceptionRules.length).toBe(0);
  });

  test('merges duplicate domains', () => {
    const duplicateSources = [
      { blockDomains: ['example.com', 'test.com'], exceptionDomains: ['safe.com'] },
      { blockDomains: ['example.com', 'other.com'], exceptionDomains: ['safe.com', 'another.com'] }
    ];

    const merged = rebuildRulesFromSources(duplicateSources);

    expect(new Set(merged.blockDomains)).toEqual(new Set(['example.com', 'test.com', 'other.com']));
    expect(new Set(merged.exceptionDomains)).toEqual(new Set(['safe.com', 'another.com']));
  });

  test('generates metadata correctly', () => {
    const sources = [
      { blockDomains: ['example.com', 'test.com'], exceptionDomains: ['safe.com'] },
      { blockDomains: ['other.com'], exceptionDomains: [] }
    ];

    const merged = rebuildRulesFromSources(sources);

    expect(merged.metadata).toBeDefined();
    expect(merged.metadata.ruleCount).toBe(4); // 3 blockDomains + 1 exceptionDomain
    expect(merged.metadata.importedAt).toBeDefined();
  });

  test('handles an empty source list', () => {
    const emptySources: Parameters<typeof rebuildRulesFromSources>[0] = [];

    const merged = rebuildRulesFromSources(emptySources);

    expect(merged.blockDomains).toEqual([]);
    expect(merged.exceptionDomains).toEqual([]);
    expect(merged.metadata.ruleCount).toBe(0);
  });

  test('merges sources containing wildcard domains', () => {
    const wildcardSources = [
      { blockDomains: ['*.example.com', 'example.*'], exceptionDomains: ['*.safe.com'] },
      { blockDomains: ['*.test.com'], exceptionDomains: [] }
    ];

    const merged = rebuildRulesFromSources(wildcardSources);

    expect(new Set(merged.blockDomains)).toEqual(new Set(['*.example.com', 'example.*', '*.test.com']));
    expect(new Set(merged.exceptionDomains)).toEqual(new Set(['*.safe.com']));
  });
});