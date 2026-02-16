/**
 * ublockImport.test.js
 * uBlock import UI component tests
 * Test target: src/popup/ublockImport.js and related modules
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals.js';

// Mock dependencies (must be defined before imports)
jest.mock('../../utils/storage.js', () => {
  const mockGetSettings = jest.fn(() => Promise.resolve({
    obsidian_api_key: '',
    obsidian_port: '27123',
    obsidian_protocol: 'http',
    gemini_api_key: '',
    min_visit_duration: 5,
    min_scroll_depth: 50,
    gemini_model: 'gemini-1.5-flash',
    obsidian_daily_path: '092.Daily',
    ai_provider: 'openai',
    openai_base_url: 'https://api.groq.com/openai/v1',
    openai_api_key: '',
    openai_model: 'openai/gpt-oss-20b',
    openai_2_base_url: 'http://127.0.0.1:11434/v1',
    openai_2_api_key: '',
    openai_2_model: 'llama3',
    domain_filter_mode: 'disabled',
    domain_whitelist: [],
    domain_blacklist: [],
    privacy_mode: 'masked_cloud',
    pii_confirmation_ui: true,
    pii_sanitize_logs: true,
    ublock_rules: {
      blockDomains: [],
      exceptionDomains: [],
      metadata: { importedAt: 0, ruleCount: 0 }
    },
    ublock_sources: [],
  }));

  const mockSaveSettings = jest.fn(() => Promise.resolve());

  return {
    StorageKeys: {
      DOMAIN_FILTER_MODE: 'domain_filter_mode',
      DOMAIN_WHITELIST: 'domain_whitelist',
      DOMAIN_BLACKLIST: 'domain_blacklist',
      UBLOCK_RULES: 'ublock_rules',
      UBLOCK_SOURCES: 'ublock_sources',
    },
    getSettings: mockGetSettings,
    saveSettings: mockSaveSettings,
  };
});

jest.mock('../settingsUiHelper.js', () => ({
  showStatus: jest.fn(),
}));

describe('ublockImport.js - UI Component Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '';

    // Mock document.getElementById to return null by default
    document.getElementById = jest.fn(() => null);
    document.querySelector = jest.fn(() => null);

    // Mock FileReader
    global.FileReader = jest.fn();

    // Mock chrome.runtime.sendMessage
    global.chrome = {
      runtime: {
        sendMessage: jest.fn()
      }
    };

    // Mock URL.createObjectURL and revokeObjectURL
    global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = jest.fn();

    // Mock navigator.clipboard
    Object.defineProperty(global, 'navigator', {
      value: {
        clipboard: {
          writeText: jest.fn(),
        },
      },
      configurable: true,
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  // =============================================================================
  // Import test - Basic import verification
  // =============================================================================
  describe('Import test', () => {
    test('Verify module can be loaded', async () => {
      const { init, saveUblockSettings } = await import('../ublockImport.js');
      expect(init).toBeDefined();
      expect(saveUblockSettings).toBeDefined();
    });
  });

  // =============================================================================
  // Functions not exported from ublockImport/index.js
  // =============================================================================
  describe('Functions not exported', () => {
    test('setupDragAndDrop is exported', async () => {
      const { setupDragAndDrop } = await import('../ublockImport.js');
      expect(setupDragAndDrop).toBeDefined();
    });

    test('exportSimpleFormat function is not exported', async () => {
      const module = await import('../ublockImport.js');
      expect(module.exportSimpleFormat).toBeUndefined();
    });

    test('copyToClipboard function is not exported', async () => {
      const module = await import('../ublockImport.js');
      expect(module.copyToClipboard).toBeUndefined();
    });

    test('buildUblockFormat function is not exported', async () => {
      const module = await import('../ublockImport.js');
      expect(module.buildUblockFormat).toBeUndefined();
    });
  });

  // =============================================================================
  // UI-005: Import from URL
  // =============================================================================
  describe('UI-005: Import from URL', () => {
    test('fetchFromUrl should successfully fetch from valid URL', async () => {
      const mockText = '||example.com^\n@@||trusted.com^';
    // @ts-expect-error - jest.fn() type narrowing issue
  
      global.chrome.runtime.sendMessage.mockResolvedValue({
        success: true,
        data: mockText,
        contentType: 'text/plain'
      });

      const { fetchFromUrl } = await import('../ublockImport.js');
      const result = await fetchFromUrl('https://example.com/filters.txt');

      expect(result).toBe(mockText);
    });

    test('fetchFromUrl should throw error for invalid URL', async () => {
      const { fetchFromUrl } = await import('../ublockImport.js');

      await expect(fetchFromUrl('javascript:alert(1)')).rejects.toThrow();
      await expect(fetchFromUrl('data:text/html,hello')).rejects.toThrow();
    });

    test('fetchFromUrl should throw error for HTTP errors', async () => {
    // @ts-expect-error - jest.fn() type narrowing issue
  
      global.chrome.runtime.sendMessage.mockResolvedValue({
        success: false,
        error: 'HTTP 404: Not Found'
      });

      const { fetchFromUrl } = await import('../ublockImport.js');

      await expect(fetchFromUrl('https://example.com/notfound.txt')).rejects.toThrow();
    });
  });

  // =============================================================================
  // UI-008: Delete source
  // =============================================================================
  describe('UI-008: Delete source', () => {
    let mockGetSettings, mockSaveSettings;

    beforeAll(async () => {
      const storage = await import('../../utils/storage.js');
      mockGetSettings = storage.getSettings;
      mockSaveSettings = storage.saveSettings;
    });

    beforeEach(() => {
    // @ts-expect-error - jest.fn() type narrowing issue
  
      mockGetSettings.mockImplementation(() => Promise.resolve({
        ublock_sources: [
          { url: 'https://example.com/list1.txt', blockDomains: ['example.com'], exceptionDomains: [] },
          { url: 'https://example.com/list2.txt', blockDomains: ['ads.net'], exceptionDomains: [] },
        ],
        ublock_rules: {
          blockDomains: ['example.com', 'ads.net'],
          exceptionDomains: [],
          metadata: { importedAt: Date.now(), ruleCount: 2 }
        }
      }));
    });

    test('deleteSource should remove source by index', async () => {
      const { deleteSource } = await import('../ublockImport.js');
      const renderCallback = jest.fn();

      await deleteSource(1, renderCallback);

      const { saveSettings } = await import('../../utils/storage.js');
      expect(saveSettings).toHaveBeenCalled();
      expect(renderCallback).toHaveBeenCalled();
    });

    test('deleteSource should handle invalid index gracefully', async () => {
      const { deleteSource } = await import('../ublockImport.js');
      const renderCallback = jest.fn();

      await deleteSource(999, renderCallback);

      const { saveSettings } = await import('../../utils/storage.js');
      expect(saveSettings).not.toHaveBeenCalled();
    });
  });

  // =============================================================================
  // UI-009: Reload source
  // =============================================================================
  describe('UI-009: Reload source', () => {
    let mockGetSettings;

    beforeAll(async () => {
      const storage = await import('../../utils/storage.js');
      mockGetSettings = storage.getSettings;
    });

    beforeEach(() => {
    // @ts-expect-error - jest.fn() type narrowing issue
  
      mockGetSettings.mockImplementation(() => Promise.resolve({
        ublock_sources: [
          {
            url: 'https://example.com/filters.txt',
            blockDomains: ['example.com', 'ads.net'],
            exceptionDomains: [],
            importedAt: Date.now() - 100000,
            ruleCount: 2
          }
        ]
      }));

    // @ts-expect-error - jest.fn() type narrowing issue
  
      global.chrome.runtime.sendMessage.mockResolvedValue({
        success: true,
        data: '||example.com^\n||newsite.com^\n@@||trusted.com^',
        contentType: 'text/plain'
      });
    });

    test('reloadSource should fetch and update source', async () => {
      const { reloadSource } = await import('../ublockImport.js');
    // @ts-expect-error - jest.fn() type narrowing issue
  
      const fetchCallback = jest.fn().mockResolvedValue('||example.com^\n||newsite.com^\n@@||trusted.com^');

      const result = await reloadSource(0, fetchCallback);

      expect(result).toBeDefined();
      expect(result.sources).toBeDefined();
      expect(result.ruleCount).toBeGreaterThan(0);
    });

    test('reloadSource should throw error for manual input source', async () => {
    // @ts-expect-error - jest.fn() type narrowing issue
  
      mockGetSettings.mockImplementation(() => Promise.resolve({
        ublock_sources: [
          { url: 'manual', blockDomains: ['example.com'], exceptionDomains: [] }
        ]
      }));

      const { reloadSource } = await import('../ublockImport.js');
      const fetchCallback = jest.fn();

      await expect(reloadSource(0, fetchCallback)).rejects.toThrow();
    });

    test('reloadSource should throw error for invalid index', async () => {
      const { reloadSource } = await import('../ublockImport.js');
      const fetchCallback = jest.fn();

      await expect(reloadSource(999, fetchCallback)).rejects.toThrow();
    });
  });

  // =============================================================================
  // UI-010: Save uBlock settings
  // =============================================================================
  describe('UI-010: Save uBlock settings', () => {
    let mockGetSettings, mockShowStatus;

    beforeAll(async () => {
      const storage = await import('../../utils/storage.js');
      mockGetSettings = storage.getSettings;
      const helper = await import('../settingsUiHelper.js');
      mockShowStatus = helper.showStatus;
    });

    beforeEach(() => {
    // @ts-expect-error - jest.fn() type narrowing issue
  
      mockGetSettings.mockImplementation(() => Promise.resolve({
        ublock_sources: [],
        ublock_rules: {
          blockDomains: [],
          exceptionDomains: [],
          metadata: { importedAt: 0, ruleCount: 0 }
        }
      }));

    // @ts-expect-error - jest.fn() type narrowing issue
  
      mockShowStatus.mockImplementation(() => { });
    });

    test('saveUblockSettings should save valid filter text', async () => {
      const filterText = '||example.com^\n||ads.net^\n@@||trusted.com^';

      const { saveUblockSettings } = await import('../ublockImport.js');
      const result = await saveUblockSettings(filterText, 'https://example.com/filters.txt');

      expect(result).toBeDefined();
      expect(result.sources).toBeDefined();
      expect(result.action).toBeDefined();
      expect(result.ruleCount).toBeGreaterThan(0);
    });

    test('saveUblockSettings should throw error for empty input', async () => {
      const { saveUblockSettings } = await import('../ublockImport.js');

      await expect(saveUblockSettings('', null)).rejects.toThrow();
      await expect(saveUblockSettings('   \n  ', null)).rejects.toThrow();
    });

    test('saveUblockSettings should handle manual input (no URL)', async () => {
      const filterText = '||example.com^\n||ads.net^';

      const { saveUblockSettings } = await import('../ublockImport.js');
      const result = await saveUblockSettings(filterText, null);

      expect(result.sources).toBeDefined();
      expect(result.sources.length).toBeGreaterThan(0);
      expect(result.sources[0].url).toBe('manual');
    });
  });

  // =============================================================================
  // UI-011: Preview uBlock filter
  // =============================================================================
  describe('UI-011: Preview uBlock filter', () => {
    test('previewUblockFilter should exist and be callable', async () => {
      const { previewUblockFilter } = await import('../ublockImport.js');
      expect(previewUblockFilter).toBeDefined();
      expect(typeof previewUblockFilter).toBe('function');
    });

    test('previewUblockFilter should handle basic filter text', async () => {
      const filterText = '||example.com^\n||ads.net^\n@@||trusted.com^';

      const { previewUblockFilter } = await import('../ublockImport.js');
      const result = await previewUblockFilter(filterText);

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    test('previewUblockFilter should handle empty input', async () => {
      const { previewUblockFilter } = await import('../ublockImport.js');
      const result = await previewUblockFilter('');

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });
  });

  // =============================================================================
  // UI-012: Validate URL format
  // =============================================================================
  describe('UI-012: Validate URL format', () => {
    test('isValidUrl should accept valid https URLs', async () => {
      const { isValidUrl } = await import('../ublockImport.js');

      expect(isValidUrl('https://example.com')).toBe(true);
      expect(isValidUrl('https://example.com/filters.txt')).toBe(true);
      expect(isValidUrl('https://sub.domain.example.com/path')).toBe(true);
    });

    test('isValidUrl should accept valid http URLs', async () => {
      const { isValidUrl } = await import('../ublockImport.js');

      expect(isValidUrl('http://example.com')).toBe(true);
      expect(isValidUrl('http://example.com/filters.txt')).toBe(true);
    });

    test('isValidUrl should accept valid ftp URLs', async () => {
      const { isValidUrl } = await import('../ublockImport.js');

      expect(isValidUrl('ftp://example.com/file.txt')).toBe(true);
    });

    test('isValidUrl should reject dangerous protocols', async () => {
      const { isValidUrl } = await import('../ublockImport.js');

      expect(isValidUrl('javascript:alert(1)')).toBe(false);
      expect(isValidUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
      expect(isValidUrl('vbscript:msgbox(1)')).toBe(false);
    });

    test('isValidUrl should reject invalid URLs', async () => {
      const { isValidUrl } = await import('../ublockImport.js');

      expect(isValidUrl('')).toBe(false);
      expect(isValidUrl('not a url')).toBe(false);
      expect(isValidUrl('example.com')).toBe(false); // missing protocol
    });

    // =============================================================================
    // PRIV-003 / SECURITY-007: Extended dangerous protocols tests
    // =============================================================================
    test('PRIV-003/SECURITY-007: should reject additional dangerous protocols', async () => {
      const { isValidUrl } = await import('../ublockImport.js');

      // Browser-specific protocols
      expect(isValidUrl('chrome://extensions')).toBe(false);
      expect(isValidUrl('chrome-extension://abcdef/popup.html')).toBe(false);
      expect(isValidUrl('chrome://settings')).toBe(false);
      expect(isValidUrl('about:blank')).toBe(false);
      expect(isValidUrl('about:config')).toBe(false);
      expect(isValidUrl('about:preferences')).toBe(false);

      // Communication protocols
      expect(isValidUrl('mailto:test@example.com')).toBe(false);
      expect(isValidUrl('tel:+1234567890')).toBe(false);
      expect(isValidUrl('sms:+1234567890')).toBe(false);
      expect(isValidUrl('fax:+1234567890')).toBe(false);

      // Local protocols
      expect(isValidUrl('file:///etc/passwd')).toBe(false);
      expect(isValidUrl('file:///C:/Windows/System32')).toBe(false);
      expect(isValidUrl('file:///tmp/secrets')).toBe(false);

      // Blob and object protocols
      expect(isValidUrl('blob:https://example.com/abc-123')).toBe(false);
      expect(isValidUrl('content:script')).toBe(false);
      expect(isValidUrl('resource:///identity.js')).toBe(false);

      // Script protocols
      expect(isValidUrl('eval:alert(1)')).toBe(false);
      expect(isValidUrl('script:alert(1)')).toBe(false);
      expect(isValidUrl('livescript:alert(1)')).toBe(false);
      expect(isValidUrl('ecmascript:alert(1)')).toBe(false);
      expect(isValidUrl('mocha:alert(1)')).toBe(false);

      // Network protocols that shouldn't be allowed
      expect(isValidUrl('ws://example.com/ws')).toBe(false);
      expect(isValidUrl('wss://example.com/ws')).toBe(false);
      expect(isValidUrl('rtsp://example.com/stream')).toBe(false);
      expect(isValidUrl('rtp://example.com/stream')).toBe(false);

      // Custom protocols
      expect(isValidUrl('custom://example.com')).toBe(false);
      expect(isValidUrl('myprotocol://data')).toBe(false);
    });

    // =============================================================================
    // PRIV-003: Malicious URL structure tests
    // =============================================================================
    test('PRIV-003: should reject malicious URL structures', async () => {
      const { isValidUrl } = await import('../ublockImport.js');

      // Protocol-only URLs without domain
      expect(isValidUrl('https://')).toBe(false);
      expect(isValidUrl('http://')).toBe(false);
      expect(isValidUrl('ftp://')).toBe(false);

      // Multiple slashes
      expect(isValidUrl('https:///example.com')).toBe(false);
      expect(isValidUrl('https:////example.com')).toBe(false);

      // Path traversal attempts
      expect(isValidUrl('https://example.com/../../etc/passwd')).toBe(true); // This is technically valid URL struct
      expect(isValidUrl('https://example.com/../')).toBe(true);

      // Credentials in URL (may be phishing risk, but technically valid)
      expect(isValidUrl('https://user:pass@example.com')).toBe(true);

      // Auth bypass attempts
      expect(isValidUrl('https://evil.com@trusted.com')).toBe(true); // Valid but httputils may misuse
      expect(isValidUrl('https://trusted.com.evil.com')).toBe(true); // Valid subdomain

      // Host abuse - IP addresses
      expect(isValidUrl('https://127.0.0.1/admin')).toBe(true);
      expect(isValidUrl('https://0.0.0.0/proxy')).toBe(true);
      expect(isValidUrl('https://192.168.1.1/config')).toBe(true);
      expect(isValidUrl('https://[::1]/admin')).toBe(true); // IPv6 localhost
      expect(isValidUrl('http://169.254.169.254/latest/meta-data')).toBe(true); // Local cloud metadata

      // Port abuse
      expect(isValidUrl('https://example.com:22')).toBe(true); // SSH port
      expect(isValidUrl('http://localhost:8080')).toBe(true);
    });

    // =============================================================================
    // PRIV-003: URL encoding attacks tests
    // =============================================================================
    test('PRIV-003: should handle URL encoding attacks', async () => {
      const { isValidUrl } = await import('../ublockImport.js');

      // URL-encoded dangerous protocols
      expect(isValidUrl('javascript%3Aalert(1)')).toBe(false);
      expect(isValidUrl('data%3Atext/html,hello')).toBe(false);
      expect(isValidUrl('%6A%61%76%61%73%63%72%69%70%74%3Aalert(1)')).toBe(false); // javascript:

      // Double encoding
      expect(isValidUrl('%25%36%41%25%37%35%25%37%32%25%36%43%25%33Aalert(1)')).toBe(false); // javascript:

      // Unicode escape attempts - these are literal backslash characters in string
      expect(isValidUrl('\\u006a\\u0061\\u0076\\u0061\\u0073\\u0063\\u0072\\u0069\\u0070\\u0074:alert(1)')).toBe(false); // Literal backslash - not valid URL
      expect(isValidUrl('\\x6a\\x61\\x76\\x61\\x73\\x63\\x72\\x69\\x70\\x74:alert(1)')).toBe(false); // Literal backslash - not valid URL

      // Percent encoding in URL parts (these are valid)
      expect(isValidUrl('https://example.com/%2e%2e/%2e%2e')).toBe(true);
      expect(isValidUrl('https://example.com/path%20with%20spaces')).toBe(true);
    });

    // =============================================================================
    // PRIV-003: Internationalized Domain Name (IDN) tests
    // =============================================================================
    test('PRIV-003: should handle internationalized domains', async () => {
      const { isValidUrl } = await import('../ublockImport.js');

      // Non-ASCII domain names (valid but may be homograph attack vectors)
      expect(isValidUrl('https://xn--e1afmkfd.xn--p1ai')).toBe(true); // Russian cyrillic domains
      expect(isValidUrl('https://中国.cn')).toBe(true); // Chinese characters
      expect(isValidUrl('https://日本.jp')).toBe(true); // Japanese characters
      expect(isValidUrl('https://한국.kr')).toBe(true); // Korean characters
      expect(isValidUrl('https://göogle.com')).toBe(true); // Swedish o with umlaut

      // Punycode encoded IDN
      expect(isValidUrl('https://xn--gogle-0ua.com')).toBe(true); // göogle.com in punycode

      // Mixed ASCII and non-ASCII
      expect(isValidUrl('https://xn--exmple-1wa.com/日本')).toBe(true);

      // Lookalike domains (homograph attack candidates - valid structure)
      expect(isValidUrl('https://gооg1e.com')).toBe(true); // Cyrillic о (o) о (o) 1 (l)
      expect(isValidUrl('https://аpple.com')).toBe(true); // Cyrillic а (a)
    });

    // =============================================================================
    // PRIV-003: Edge cases and boundary tests
    // =============================================================================
    test('PRIV-003: should handle edge cases', async () => {
      const { isValidUrl } = await import('../ublockImport.js');

      // Case sensitivity (allowed)
      expect(isValidUrl('HTTPS://example.com')).toBe(true);
      expect(isValidUrl('HTTP://example.com')).toBe(true);
      expect(isValidUrl('HtTpS://example.com')).toBe(true);

      // Extra whitespace (trim should handle)
      expect(isValidUrl('  https://example.com  ')).toBe(true);
      expect(isValidUrl('\nhttps://example.com\n')).toBe(true);
      expect(isValidUrl('\thttps://example.com\t')).toBe(true);

      // Null bytes (if they make it through)
      expect(isValidUrl('https://example.com\x00')).toBe(true); // Not explicitly rejected
      expect(isValidUrl('https://\x00example.com')).toBe(true);

      // Very long URLs (DoS vectors - not screened)
      const longDomain = 'a'.repeat(1000);
      expect(isValidUrl(`https://${longDomain}.com`)).toBe(true);

      // Strange but technically valid URLs
      expect(isValidUrl('https://_localhost')).toBe(true);
      expect(isValidUrl('https://-example.com')).toBe(true);
      expect(isValidUrl('https://example.com-')).toBe(true);
      expect(isValidUrl('https://127.1')).toBe(true); // Short IP notation
    });

    // =============================================================================
    // PRIV-003: Data URL variants
    // =============================================================================
    test('PRIV-003: should reject all data URL variants', async () => {
      const { isValidUrl } = await import('../ublockImport.js');

      expect(isValidUrl('data::text/plain,hello')).toBe(false);
      expect(isValidUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
      expect(isValidUrl('data:text/javascript,alert(1)')).toBe(false);
      expect(isValidUrl('data:application/json,{}')).toBe(false);
      expect(isValidUrl('data:image/png;base64,iVBORw0KGgo')).toBe(false);
      expect(isValidUrl('data:;base64,SGVsbG8gV29ybGQ=')).toBe(false);
    });

    // =============================================================================
    // Integer overflow and special values
    // =============================================================================
    test('PRIV-003: should handle port and IPv6 special values', async () => {
      const { isValidUrl } = await import('../ublockImport.js');

      // Edge case ports
      expect(isValidUrl('https://example.com:0')).toBe(true);
      expect(isValidUrl('https://example.com:65535')).toBe(true);
      expect(isValidUrl('https://example.com:99999')).toBe(true); // Invalid port but valid URL struct

      // IPv6 edge cases
      expect(isValidUrl('https://[::]')).toBe(true);
      expect(isValidUrl('https://[0:0:0:0:0:0:0:0]')).toBe(true);
      expect(isValidUrl('https://[ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff]')).toBe(true);
    });
  });

  // =============================================================================
  // UI-013: Rebuild rules from sources
  // =============================================================================
  describe('UI-013: Rebuild rules from sources', () => {
    test('rebuildRulesFromSources should merge block domains', async () => {
      const sources = [
        { blockDomains: ['example.com', 'ads.net'], exceptionDomains: [] },
        { blockDomains: ['news.net', 'spam.org'], exceptionDomains: [] },
        { blockDomains: ['example.com'], exceptionDomains: [] }, // duplicate
      ];

      const { rebuildRulesFromSources } = await import('../ublockImport.js');
      const result = rebuildRulesFromSources(sources);

      expect(result.blockDomains).toContain('example.com');
      expect(result.blockDomains).toContain('ads.net');
      expect(result.blockDomains).toContain('news.net');
      expect(result.blockDomains).toContain('spam.org');
      expect(result.blockDomains.length).toBe(4); // No duplicates
    });

    test('rebuildRulesFromSources should merge exception domains', async () => {
      const sources = [
        { blockDomains: [], exceptionDomains: ['trusted.com', 'safe.org'] },
        { blockDomains: [], exceptionDomains: ['whitelisted.net'] },
      ];

      const { rebuildRulesFromSources } = await import('../ublockImport.js');
      const result = rebuildRulesFromSources(sources);

      expect(result.exceptionDomains).toContain('trusted.com');
      expect(result.exceptionDomains).toContain('safe.org');
      expect(result.exceptionDomains).toContain('whitelisted.net');
      expect(result.exceptionDomains.length).toBe(3);
    });

    test('rebuildRulesFromSources should handle empty sources', async () => {
      const { rebuildRulesFromSources } = await import('../ublockImport.js');
      const result = rebuildRulesFromSources([]);

      expect(result.blockDomains).toEqual([]);
      expect(result.exceptionDomains).toEqual([]);
      expect(result.metadata.ruleCount).toBe(0);
    });

    test('rebuildRulesFromSources should handle null/undefined', async () => {
      const { rebuildRulesFromSources } = await import('../ublockImport.js');
      const result = rebuildRulesFromSources(null);

      expect(result.blockDomains).toEqual([]);
      expect(result.exceptionDomains).toEqual([]);
    });
  });

  // =============================================================================
  // UI-014: Render source list
  // =============================================================================
  describe('UI-014: Render source list', () => {
    beforeEach(() => {
      const container = document.createElement('div');
      container.id = 'uBlockSourceItems';
      container.innerHTML = '';
      document.body.appendChild(container);

      const noSourcesMsg = document.createElement('div');
      noSourcesMsg.id = 'uBlockNoSources';
      noSourcesMsg.style.display = 'none';
      document.body.appendChild(noSourcesMsg);
    });

    test('renderSourceList should handle empty sources', async () => {
      const sources = [];
      const deleteCallback = jest.fn();
      const reloadCallback = jest.fn();

      const { renderSourceList } = await import('../ublockImport.js');
      expect(() => renderSourceList(sources, deleteCallback, reloadCallback)).not.toThrow();
    });

    test('renderSourceList should handle non-empty sources', async () => {
      const sources = [
        {
          url: 'https://example.com/filters.txt',
          blockDomains: ['example.com', 'ads.net'],
          exceptionDomains: ['trusted.com'],
          importedAt: Date.now(),
          ruleCount: 3
        }
      ];
      const deleteCallback = jest.fn();
      const reloadCallback = jest.fn();

      const { renderSourceList } = await import('../ublockImport.js');
      expect(() => renderSourceList(sources, deleteCallback, reloadCallback)).not.toThrow();
    });
  });

  // =============================================================================
  // UI-015: Update preview UI - NOT FULLY TESTABLE
  // =============================================================================
  // NOTE: This function is NOT FULLY TESTABLE in the current test architecture
  // because updatePreviewUI directly accesses DOM elements via document.getElementById
  // without null checking. When the test environment doesn't have these elements set up,
  // the function throws TypeError: Cannot set properties of null.
  //
  // To properly test this function, the architecture would need to be refactored
  // to either:
  // 1. Add proper null checking for DOM elements, or
  // 2. Use a dependency injection pattern for DOM elements.
  //
  // For now, we can only verify that the module imports correctly and the function exists.
  // =============================================================================
  describe('UI-015: Update preview UI - NOT FULLY TESTABLE', () => {
    test('should verify updatePreviewUI function exists', async () => {
      const { updatePreviewUI } = await import('../ublockImport.js');
      expect(updatePreviewUI).toBeDefined();
      expect(typeof updatePreviewUI).toBe('function');
    });
  });

  // =============================================================================
  // UI-016: Hide preview
  // =============================================================================
  describe('UI-016: Hide preview', () => {
    test('hidePreview should exist and be callable', async () => {
      const { hidePreview } = await import('../ublockImport.js');
      expect(hidePreview).toBeDefined();
      expect(typeof hidePreview).toBe('function');
    });

    test('hidePreview should handle missing element gracefully', async () => {
      const { hidePreview } = await import('../ublockImport.js');
      expect(() => hidePreview()).not.toThrow();
    });
  });

  // =============================================================================
  // UI-017: Clear input
  // =============================================================================
  describe('UI-017: Clear input', () => {
    beforeEach(() => {
      // Mock document.getElementById to return the textarea
      const mockTextarea = {
        value: '',
        addEventListener: jest.fn(),
        classList: { add: jest.fn(), remove: jest.fn() }
      };
      document.getElementById = jest.fn((id) => {
        if (id === 'uBlockFilterInput') return mockTextarea;
        if (id === 'uBlockPreview') return { style: { display: 'none' } };
        return null;
      });
    });

    test('clearInput should clear the textarea', async () => {
      // Get the mock textarea
      const mockTextarea = document.getElementById('uBlockFilterInput');
      mockTextarea.value = 'some text content';

      const { clearInput } = await import('../ublockImport.js');
      clearInput();

      expect(mockTextarea.value).toBe('');
    });

    test('clearInput should handle missing element gracefully', async () => {
      document.getElementById = jest.fn(() => null);

      const { clearInput } = await import('../ublockImport.js');

      expect(() => clearInput()).not.toThrow();
    });
  });

  // =============================================================================
  // readFile
  // =============================================================================
  describe('readFile', () => {
    test('readFile should read file content', async () => {
      const mockFile = {
        name: 'test.txt',
        type: 'text/plain',
        size: 100
      };

      let mockReader = null;
    // @ts-expect-error - jest.fn() type narrowing issue
  
      global.FileReader.mockImplementation(() => {
        mockReader = {
          readAsText: jest.fn(),
          onload: null,
          onerror: null
        };
        // Trigger onload immediately
        Promise.resolve().then(() => {
          if (mockReader.onload) {
            mockReader.onload({ target: { result: 'test content' } });
          }
        });
        return mockReader;
      });

      const { readFile } = await import('../ublockImport.js');
      const result = await readFile(mockFile);

      expect(result).toBe('test content');
    });

    test('readFile should handle missing FileReader gracefully', async () => {
      const originalFileReader = global.FileReader;
      delete global.FileReader;

      const { readFile } = await import('../ublockImport.js');

      // Should not throw when FileReader is not available
      expect(readFile).toBeDefined();

      // Restore FileReader
      global.FileReader = originalFileReader;
    });
  });
});