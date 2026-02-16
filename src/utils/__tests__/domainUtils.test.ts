/**
 * domainUtils.test.ts
 * ドメインユーティリティ関数のテスト
 * 【テスト対象】: src/utils/domainUtils.ts
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import {
  extractDomain,
  matchesPattern,
  isDomainInList,
  isValidDomain,
  isDomainAllowed,
  parseDomainList,
  validateDomainList
} from '../domainUtils';
import { isUrlBlocked } from '../ublockMatcher';
import { getSettings, type Settings } from '../storage';

// Mock ublockMatcher.ts
jest.mock('../ublockMatcher', () => ({
  __esModule: true,
  isUrlBlocked: jest.fn()
}));

// Mock storage.ts
jest.mock('../storage', () => ({
  __esModule: true,
  StorageKeys: {
    DOMAIN_FILTER_MODE: 'domain_filter_mode',
    DOMAIN_WHITELIST: 'domain_whitelist',
    DOMAIN_BLACKLIST: 'domain_blacklist',
    UBLOCK_RULES: 'ublock_rules',
    UBLOCK_FORMAT_ENABLED: 'ublock_format_enabled',
    SIMPLE_FORMAT_ENABLED: 'simple_format_enabled'
  },
  getSettings: jest.fn()
}));

const mockedIsUrlBlocked = isUrlBlocked as jest.MockedFunction<typeof isUrlBlocked>;
const mockedGetSettings = getSettings as jest.MockedFunction<typeof getSettings>;

describe('domainUtils', () => {
  // 【テスト前準備】: 各テスト実行前にChrome APIのモックをクリア
  // 【環境初期化】: 前のテストの影響を受けないよう、モックの呼び出し履歴をリセット
  beforeEach(() => {
    jest.clearAllMocks();
    mockedIsUrlBlocked.mockReset();
    mockedIsUrlBlocked.mockResolvedValue(false);
    mockedGetSettings.mockReset();
    mockedGetSettings.mockResolvedValue({});
  });

  describe('extractDomain', () => {
    test('標準的なHTTP URLからドメインを正しく抽出できる', () => {
      const url = 'http://example.com/path/to/page';
      const result = extractDomain(url);
      expect(result).toBe('example.com');
    });

    test('www付きドメインからwwwを除去して抽出できる', () => {
      const url = 'https://www.example.com/';
      const result = extractDomain(url);
      expect(result).toBe('example.com');
    });

    test('不正なURL文字列からドメイン抽出を試みた場合nullを返す', () => {
      const invalidUrl = 'not-a-valid-url';
      const result = extractDomain(invalidUrl);
      expect(result).toBeNull();
    });
  });

  describe('matchesPattern', () => {
    test('ワイルドカード無しパターンで完全一致を検出できる', () => {
      const domain = 'example.com';
      const pattern = 'example.com';
      const result = matchesPattern(domain, pattern);
      expect(result).toBe(true);
    });

    test('ワイルドカードパターンでサブドメインをマッチできる', () => {
      const domain = 'sub.example.com';
      const pattern = '*.example.com';
      const result = matchesPattern(domain, pattern);
      expect(result).toBe(true);
    });

    test('空文字列パターンでのマッチング動作を確認', () => {
      const domain = 'example.com';
      const pattern = '';
      const result = matchesPattern(domain, pattern);
      expect(result).toBe(false);
    });

    test('複数のワイルドカードを含むパターンを正しく処理できる', () => {
      const domain = 'sub.api.example.com';
      const pattern = '*.*.example.com';
      const result = matchesPattern(domain, pattern);
      expect(result).toBe(true);
    });
  });

  describe('isDomainInList', () => {
    test('ドメインリストに含まれるドメインを正しく検出できる', () => {
      const domain = 'example.com';
      const domainList = ['example.com', 'test.com'];
      const result = isDomainInList(domain, domainList);
      expect(result).toBe(true);
    });

    test('ドメインリストが空配列の場合は常にfalseを返す', () => {
      const domain = 'example.com';
      const domainList: string[] = [];
      const result = isDomainInList(domain, domainList);
      expect(result).toBe(false);
    });
  });

  describe('isValidDomain', () => {
    test('標準的なドメイン形式を有効と判定できる', () => {
      const domain = 'example.com';
      const result = isValidDomain(domain);
      expect(result).toBe(true);
    });

    test('特殊文字を含む不正なドメインを検出できる', () => {
      const domain = 'example<script>.com';
      const result = isValidDomain(domain);
      expect(result).toBe(false);
    });

    test('RFC準拠の最大長ドメイン（253文字）を有効と判定できる', () => {
      const longDomain = 'a'.repeat(63) + '.' + 'b'.repeat(63) + '.' + 'c'.repeat(63) + '.' + 'd'.repeat(61);
      const result = isValidDomain(longDomain);
      expect(result).toBe(true);
    });
  });

  describe('isDomainAllowed', () => {
    test('ドメインフィルターが無効な場合は全てのドメインを許可する', async () => {
      mockedGetSettings.mockResolvedValue({ domain_filter_mode: 'disabled' } as Settings);
      const url = 'https://any-domain.com';
      const result = await isDomainAllowed(url);
      expect(result).toBe(true);
    });

    test('ホワイトリストモードで登録済みドメインを許可する', async () => {
      mockedGetSettings.mockResolvedValue({
        domain_filter_mode: 'whitelist',
        domain_whitelist: ['allowed.com']
      } as Settings);
      const url = 'https://allowed.com/page';
      const result = await isDomainAllowed(url);
      expect(result).toBe(true);
    });

    test('ブラックリストモードで登録済みドメインを拒否する', async () => {
      mockedGetSettings.mockResolvedValue({
        domain_filter_mode: 'blacklist',
        domain_blacklist: ['blocked.com']
      } as Settings);
      const url = 'https://blocked.com/page';
      const result = await isDomainAllowed(url);
      expect(result).toBe(false);
    });

    test('ドメイン抽出に失敗した場合はfalseを返す', async () => {
      mockedGetSettings.mockResolvedValue({ domain_filter_mode: 'whitelist' } as Settings);
      const invalidUrl = 'invalid-url';
      const result = await isDomainAllowed(invalidUrl);
      expect(result).toBe(false);
    });

    test('シンプル形式とuBlock形式の両方が有効な場合の併用動作を確認', async () => {
      mockedIsUrlBlocked.mockResolvedValue(true);

      mockedGetSettings.mockResolvedValue({
        domain_filter_mode: 'blacklist',
        simple_format_enabled: true,
        domain_blacklist: ['blocked-simple.com'],
        ublock_format_enabled: true,
        ublock_rules: {
          blockRules: [{ domain: 'blocked-ublock.com', type: 'block' }],
          exceptionRules: [],
          ruleCount: 1
        }
      } as Settings);

      mockedIsUrlBlocked.mockImplementation(async (url) => {
        if (url.includes('blocked-ublock.com')) return true;
        return false;
      });

      expect(await isDomainAllowed('https://allowed.com')).toBe(true);
      expect(await isDomainAllowed('https://blocked-simple.com')).toBe(false);
      expect(await isDomainAllowed('https://blocked-ublock.com')).toBe(false);
    });

    test('片方のみ有効な場合の動作を確認', async () => {
      mockedIsUrlBlocked.mockResolvedValue(true);

      mockedGetSettings.mockResolvedValue({
        domain_filter_mode: 'blacklist',
        simple_format_enabled: true,
        domain_blacklist: ['blocked.com'],
        ublock_format_enabled: false,
        ublock_rules: {
          blockRules: [{ type: 'hostname', domain: 'allowed-because-disabled.com' }],
          exceptionRules: [],
          ruleCount: 1
        }
      } as Settings);

      expect(await isDomainAllowed('https://blocked.com')).toBe(false);
      expect(await isDomainAllowed('https://allowed-because-disabled.com')).toBe(true);
    });
  });

  describe('LOG-006: uBlock block rule - blocked', () => {
    test('Verify uBlock block rule blocks URL', async () => {
      mockedIsUrlBlocked.mockResolvedValue(true);

      mockedGetSettings.mockResolvedValue({
        domain_filter_mode: 'blacklist',
        simple_format_enabled: false,
        ublock_format_enabled: true,
        ublock_rules: {
          blockRules: [{ type: 'hostname', domain: 'blocked.com' }],
          exceptionRules: [],
          ruleCount: 1
        }
      } as Settings);

      const result = await isDomainAllowed('https://blocked.com/page');
      expect(result).toBe(false);
    });
  });

  describe('LOG-007: uBlock exception rule - allowed', () => {
    test('Verify uBlock exception rule allows URL', async () => {
      mockedIsUrlBlocked.mockResolvedValue(false);

      mockedGetSettings.mockResolvedValue({
        domain_filter_mode: 'blacklist',
        simple_format_enabled: false,
        ublock_format_enabled: true,
        ublock_rules: {
          blockRules: [{ type: 'hostname', pattern: '*.com' }],
          exceptionRules: [{ type: 'hostname', domain: 'allowed.com' }],
          ruleCount: 2
        }
      } as Settings);

      const result = await isDomainAllowed('https://allowed.com/page');
      expect(result).toBe(true);
    });
  });

  describe('LOG-008: Both enabled - Simple blocks', () => {
    test('Verify Simple blocks when both enabled', async () => {
      mockedIsUrlBlocked.mockResolvedValue(false);

      mockedGetSettings.mockResolvedValue({
        domain_filter_mode: 'blacklist',
        simple_format_enabled: true,
        domain_blacklist: ['blocked-simple.com'],
        ublock_format_enabled: true,
        ublock_rules: {
          blockRules: [],
          exceptionRules: [],
          ruleCount: 0
        }
      } as Settings);

      const result = await isDomainAllowed('https://blocked-simple.com/page');
      expect(result).toBe(false);
    });
  });

  describe('LOG-009: Both enabled - uBlock blocks', () => {
    test('Verify uBlock blocks when both enabled', async () => {
      mockedIsUrlBlocked.mockResolvedValue(true);

      mockedGetSettings.mockResolvedValue({
        domain_filter_mode: 'blacklist',
        simple_format_enabled: true,
        domain_blacklist: [],
        ublock_format_enabled: true,
        ublock_rules: {
          blockRules: [{ type: 'hostname', domain: 'blocked-ublock.com' }],
          exceptionRules: [],
          ruleCount: 1
        }
      } as Settings);

      const result = await isDomainAllowed('https://blocked-ublock.com/page');
      expect(result).toBe(false);
    });
  });

  describe('LOG-010: Both enabled - both block', () => {
    test('Verify both block when both enabled', async () => {
      mockedIsUrlBlocked.mockResolvedValue(true);

      mockedGetSettings.mockResolvedValue({
        domain_filter_mode: 'blacklist',
        simple_format_enabled: true,
        domain_blacklist: ['blocked-both.com'],
        ublock_format_enabled: true,
        ublock_rules: {
          blockRules: [{ type: 'hostname', domain: 'blocked-both.com' }],
          exceptionRules: [],
          ruleCount: 1
        }
      } as Settings);

      const result = await isDomainAllowed('https://blocked-both.com/page');
      expect(result).toBe(false);
    });
  });

  describe('LOG-011: Both enabled - both allow', () => {
    test('Verify both allow when both enabled', async () => {
      mockedIsUrlBlocked.mockResolvedValue(false);

      mockedGetSettings.mockResolvedValue({
        domain_filter_mode: 'blacklist',
        simple_format_enabled: true,
        domain_blacklist: [],
        ublock_format_enabled: true,
        ublock_rules: {
          blockRules: [],
          exceptionRules: [],
          ruleCount: 0
        }
      } as Settings);

      const result = await isDomainAllowed('https://allowed.com/page');
      expect(result).toBe(true);
    });
  });

  describe('LOG-012: Simple only - uBlock ignored', () => {
    test('Verify uBlock ignored when Simple only', async () => {
      mockedIsUrlBlocked.mockResolvedValue(true);

      mockedGetSettings.mockResolvedValue({
        domain_filter_mode: 'blacklist',
        simple_format_enabled: true,
        domain_blacklist: [],
        ublock_format_enabled: false,
        ublock_rules: {
          blockRules: [{ type: 'hostname', domain: 'blocked-by-ublock.com' }],
          exceptionRules: [],
          ruleCount: 1
        }
      } as Settings);

      const result = await isDomainAllowed('https://blocked-by-ublock.com/page');
      expect(result).toBe(true);
    });
  });

  describe('LOG-013: uBlock only - Simple ignored', () => {
    test('Verify Simple ignored when uBlock only', async () => {
      mockedIsUrlBlocked.mockResolvedValue(false);

      mockedGetSettings.mockResolvedValue({
        domain_filter_mode: 'blacklist',
        simple_format_enabled: false,
        domain_blacklist: ['blocked-by-simple.com'],
        ublock_format_enabled: true,
        ublock_rules: {
          blockRules: [],
          exceptionRules: [],
          ruleCount: 0
        }
      } as Settings);

      const result = await isDomainAllowed('https://blocked-by-simple.com/page');
      expect(result).toBe(true);
    });
  });

  describe('LOG-015: Empty rules - all allowed', () => {
    test('Verify empty rules allow all', async () => {
      mockedGetSettings.mockResolvedValue({
        domain_filter_mode: 'blacklist',
        simple_format_enabled: true,
        domain_blacklist: [],
        ublock_format_enabled: true,
        ublock_rules: {
          blockRules: [],
          exceptionRules: [],
          ruleCount: 0
        }
      } as Settings);

      const result = await isDomainAllowed('https://any-domain.com/page');
      expect(result).toBe(true);
    });
  });

  describe('LOG-016: Wildcard in Simple list', () => {
    test('Verify wildcard patterns work', async () => {
      mockedGetSettings.mockResolvedValue({
        domain_filter_mode: 'blacklist',
        simple_format_enabled: true,
        domain_blacklist: ['*.example.com'],
        ublock_format_enabled: false
      } as Settings);

      const result1 = await isDomainAllowed('https://sub.example.com/page');
      const result2 = await isDomainAllowed('https://another.example.com/page');
      const result3 = await isDomainAllowed('https://other.com/page');

      expect(result1).toBe(false);
      expect(result2).toBe(false);
      expect(result3).toBe(true);
    });
  });

  describe('LOG-018: uBlock exception overrides block', () => {
    test('Verify exception overrides block', async () => {
      mockedGetSettings.mockResolvedValue({
        domain_filter_mode: 'blacklist',
        simple_format_enabled: false,
        ublock_format_enabled: true,
        ublock_rules: {
          blockRules: [{ type: 'hostname', domain: 'example.com' }],
          exceptionRules: [{ type: 'hostname', domain: 'example.com' }],
          ruleCount: 2
        }
      } as Settings);

      const result = await isDomainAllowed('https://example.com/page');
      expect(result).toBe(true);
    });
  });

  describe('parseDomainList', () => {
    test('大量のドメインリスト（1000行）を正しくパースできる', () => {
      const domainLines = Array.from({ length: 1000 }, (_, i) => `domain${i}.com`);
      const text = domainLines.join('\n');
      const result = parseDomainList(text);
      expect(result).toHaveLength(1000);
      expect(result[0]).toBe('domain0.com');
      expect(result[999]).toBe('domain999.com');
    });
  });

  describe('validateDomainList', () => {
    test('有効と無効なドメインが混在するリストのエラーを正しく報告できる', () => {
      const domainList = ['valid.com', 'invalid<>.com', 'another-valid.com', 'bad domain'];
      const errors = validateDomainList(domainList);
      expect(errors).toHaveLength(2);
      expect(errors[0]).toContain('2行目');
      expect(errors[0]).toContain('invalid<>.com');
      expect(errors[1]).toContain('4行目');
      expect(errors[1]).toContain('bad domain');
    });
  });
});