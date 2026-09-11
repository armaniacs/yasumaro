/**
 * domainUtils.test.ts
 * ドメインユーティリティ関数のテスト
 * 【テスト対象】: src/utils/domainUtils.ts
 */

import { vi } from 'vitest';
import type { MockedFunction } from 'vitest';
import {
  extractDomain,
  matchesPattern,
  isDomainInList,
  isValidDomain,
  isDomainAllowed,
  parseDomainList,
  validateDomainList
} from '../domainUtils.js';
import { isUrlBlocked } from '../ublockMatcher.js';
import type { Settings as SettingsType } from '../storage/types.js';
import { settingsRepository } from '../storage/SettingsRepository.js';

// Mock ublockMatcher.ts
vi.mock('../ublockMatcher', () => ({
  __esModule: true,
  isUrlBlocked: vi.fn()
}));

vi.mock('../storage/SettingsRepository.js', async (importOriginal) => {
  const actual = await (importOriginal as () => Promise<typeof import('../storage/SettingsRepository.js')>)();
  return {
    ...actual,
    settingsRepository: {
      ...actual.settingsRepository,
      getAll: vi.fn(),
    },
  };
});

type Settings = SettingsType;

const mockedIsUrlBlocked = isUrlBlocked as MockedFunction<typeof isUrlBlocked>;
const mockedGetAll = settingsRepository.getAll as MockedFunction<typeof settingsRepository.getAll>;
const mockedGetSettings = mockedGetAll;

describe('domainUtils', () => {
  // 【テスト前準備】: 各テスト実行前にChrome APIのモックをクリア
  // 【環境初期化】: 前のテストの影響を受けないよう、モックの呼び出し履歴をリセット
  beforeEach(() => {
    vi.clearAllMocks();
    mockedIsUrlBlocked.mockReset();
  
    mockedIsUrlBlocked.mockResolvedValue(false);
    mockedGetSettings.mockReset();
  
    mockedGetSettings.mockResolvedValue({});
  });

  describe('extractDomain', () => {
    test('extracts the domain correctly from a standard HTTP URL', () => {
      const url = 'http://example.com/path/to/page';
      const result = extractDomain(url);
      expect(result).toBe('example.com');
    });

    test('strips www and extracts the domain from a www-prefixed domain', () => {
      const url = 'https://www.example.com/';
      const result = extractDomain(url);
      expect(result).toBe('example.com');
    });

    test('returns null when extracting a domain from an invalid URL string', () => {
      const invalidUrl = 'not-a-valid-url';
      const result = extractDomain(invalidUrl);
      expect(result).toBeNull();
    });
  });

  describe('matchesPattern', () => {
    test('detects exact matches with a wildcard-free pattern', () => {
      const domain = 'example.com';
      const pattern = 'example.com';
      const result = matchesPattern(domain, pattern);
      expect(result).toBe(true);
    });

    test('matches subdomains with a wildcard pattern', () => {
      const domain = 'sub.example.com';
      const pattern = '*.example.com';
      const result = matchesPattern(domain, pattern);
      expect(result).toBe(true);
    });

    test('verifies matching behavior with an empty string pattern', () => {
      const domain = 'example.com';
      const pattern = '';
      const result = matchesPattern(domain, pattern);
      expect(result).toBe(false);
    });

    test('handles patterns with multiple wildcards correctly', () => {
      const domain = 'sub.api.example.com';
      const pattern = '*.*.example.com';
      const result = matchesPattern(domain, pattern);
      expect(result).toBe(true);
    });
  });

  describe('isDomainInList', () => {
    test('detects domains contained in the domain list correctly', () => {
      const domain = 'example.com';
      const domainList = ['example.com', 'test.com'];
      const result = isDomainInList(domain, domainList);
      expect(result).toBe(true);
    });

    test('always returns false when the domain list is an empty array', () => {
      const domain = 'example.com';
      const domainList: string[] = [];
      const result = isDomainInList(domain, domainList);
      expect(result).toBe(false);
    });
  });

  describe('isValidDomain', () => {
    test('judges a standard domain format as valid', () => {
      const domain = 'example.com';
      const result = isValidDomain(domain);
      expect(result).toBe(true);
    });

    test('detects invalid domains containing special characters', () => {
      const domain = 'example<script>.com';
      const result = isValidDomain(domain);
      expect(result).toBe(false);
    });

    test('judges an RFC-compliant maximum-length domain (253 characters) as valid', () => {
      const longDomain = 'a'.repeat(63) + '.' + 'b'.repeat(63) + '.' + 'c'.repeat(63) + '.' + 'd'.repeat(61);
      const result = isValidDomain(longDomain);
      expect(result).toBe(true);
    });
  });

  describe('isDomainAllowed', () => {
    test('allows all domains when the domain filter is disabled', async () => {
  
      mockedGetSettings.mockResolvedValue({ domain_filter_mode: 'disabled' } as Settings);
      const url = 'https://any-domain.com';
      const result = await isDomainAllowed(url);
      expect(result).toBe(true);
    });

    test('allows registered domains in whitelist mode', async () => {
  
      mockedGetSettings.mockResolvedValue({
        domain_filter_mode: 'whitelist',
        domain_whitelist: ['allowed.com']
      } as Settings);
      const url = 'https://allowed.com/page';
      const result = await isDomainAllowed(url);
      expect(result).toBe(true);
    });

    test('rejects registered domains in blacklist mode', async () => {
  
      mockedGetSettings.mockResolvedValue({
        domain_filter_mode: 'blacklist',
        domain_blacklist: ['blocked.com']
      } as Settings);
      const url = 'https://blocked.com/page';
      const result = await isDomainAllowed(url);
      expect(result).toBe(false);
    });

    test('returns false when domain extraction fails', async () => {

      mockedGetSettings.mockResolvedValue({ domain_filter_mode: 'whitelist' } as Settings);
      const invalidUrl = 'invalid-url';
      const result = await isDomainAllowed(invalidUrl);
      expect(result).toBe(false);
    });

    test('rejects subdomains when subdomain matching is OFF (default)', async () => {
      mockedGetSettings.mockResolvedValue({
        domain_filter_mode: 'whitelist',
        domain_whitelist: ['example.com']
      } as Settings);
      const result = await isDomainAllowed('https://sub.example.com/page');
      expect(result).toBe(false);
    });

    test('allows subdomains when subdomain matching is ON', async () => {
      mockedGetSettings.mockResolvedValue({
        domain_filter_mode: 'whitelist',
        domain_whitelist: ['example.com'],
        domain_subdomain_matching: true
      } as unknown as Settings);
      const result = await isDomainAllowed('https://sub.example.com/page');
      expect(result).toBe(true);
    });

    test('rejects blacklisted subdomains when subdomain matching is ON', async () => {
      mockedGetSettings.mockResolvedValue({
        domain_filter_mode: 'blacklist',
        domain_blacklist: ['example.com'],
        domain_subdomain_matching: true
      } as unknown as Settings);
      const result = await isDomainAllowed('https://www.example.com/page');
      expect(result).toBe(false);
    });

    test('verifies combined behavior when both Simple and uBlock formats are enabled', async () => {
  
      mockedIsUrlBlocked.mockResolvedValue(true);

    // @ts-expect-error - vi.fn() type narrowing issue
  
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

    test('verifies behavior when only one format is enabled', async () => {
  
      mockedIsUrlBlocked.mockResolvedValue(true);

    // @ts-expect-error - vi.fn() type narrowing issue
  
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

    // @ts-expect-error - vi.fn() type narrowing issue
  
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

    // @ts-expect-error - vi.fn() type narrowing issue
  
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

    // @ts-expect-error - vi.fn() type narrowing issue
  
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

    // @ts-expect-error - vi.fn() type narrowing issue
  
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

    // @ts-expect-error - vi.fn() type narrowing issue
  
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

    // @ts-expect-error - vi.fn() type narrowing issue
  
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

    // @ts-expect-error - vi.fn() type narrowing issue
  
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

    // @ts-expect-error - vi.fn() type narrowing issue
  
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
    // @ts-expect-error - vi.fn() type narrowing issue
  
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
    // @ts-expect-error - vi.fn() type narrowing issue
  
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
    test('parses a large domain list (1000 lines) correctly', () => {
      const domainLines = Array.from({ length: 1000 }, (_, i) => `domain${i}.com`);
      const text = domainLines.join('\n');
      const result = parseDomainList(text);
      expect(result).toHaveLength(1000);
      expect(result[0]).toBe('domain0.com');
      expect(result[999]).toBe('domain999.com');
    });
  });

  describe('validateDomainList', () => {
    test('reports errors correctly for a list mixing valid and invalid domains', () => {
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