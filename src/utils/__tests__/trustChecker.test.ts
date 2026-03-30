/**
 * @jest-environment jsdom
 */

/**
 * trustChecker.test.ts
 * Unit tests for Trust Checker (Phase 2)
 * Alert settings and Trust check logic
 */

import { jest } from '@jest/globals';

// Mock chrome.storage.local - re-set in beforeEach to survive clearAllMocks
const mockStorage = new Map();

function setupChromeMocks() {
  (global as any).chrome = {
    storage: {
      local: {
        get: jest.fn().mockImplementation((keys: any, callback?: any) => {
          const result: Record<string, unknown> = {};
          if (keys === undefined || keys === null) {
            return Promise.resolve(Object.fromEntries(mockStorage));
          }
          if (typeof keys === 'object' && !Array.isArray(keys)) {
            Object.entries(keys as Record<string, unknown>).forEach(([key, defaultVal]) => {
              result[key] = mockStorage.has(key) ? mockStorage.get(key) : defaultVal;
            });
          } else {
            const keyArray = Array.isArray(keys) ? keys : [keys];
            keyArray.forEach(key => {
              if (mockStorage.has(key)) {
                result[key] = mockStorage.get(key);
              }
            });
          }
          if (callback) {
            callback(result);
          }
          return Promise.resolve(result);
        }),
        set: jest.fn().mockImplementation((items: any, callback?: any) => {
          Object.entries(items as Record<string, unknown>).forEach(([key, value]) => {
            mockStorage.set(key, value);
          });
          if (callback) {
            callback();
          }
          return Promise.resolve();
        })
      }
    }
  } as any;
}

// Mock logger to prevent real storage calls from logWarn/logDebug
jest.mock('../logger.js', () => ({
  logInfo: jest.fn().mockResolvedValue(undefined),
  logDebug: jest.fn().mockResolvedValue(undefined),
  logWarn: jest.fn().mockResolvedValue(undefined),
  logError: jest.fn().mockResolvedValue(undefined),
  ErrorCode: {
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    TRUST_DB_NOT_INITIALIZED: 'TRUST_DB_NOT_INITIALIZED',
    TRUST_DB_INIT_FAILED: 'TRUST_DB_INIT_FAILED',
    TRUST_DB_MIGRATION_FAILED: 'TRUST_DB_MIGRATION_FAILED',
  }
}));

// Mock for trustDb
const mockDbInitialize = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockIsDomainTrusted = jest.fn();

jest.mock('../trustDb/trustDb.js', () => ({
  getTrustDb: jest.fn(() => ({
    initialize: mockDbInitialize,
    isDomainTrusted: mockIsDomainTrusted,
  })),
}));

// Initialize chrome mocks at module level
setupChromeMocks();

describe('TrustChecker - Phase 2 - Module Loading', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage.clear();
    setupChromeMocks();
  });

  it('should trustChecker module be loadable', async () => {
    const trustCheckerModule = await import('../trustChecker.js');
    expect(trustCheckerModule).toBeDefined();
    expect(typeof trustCheckerModule.getTrustChecker).toBe('function');
    expect(typeof trustCheckerModule.checkDomainTrust).toBe('function');
    expect(typeof trustCheckerModule.getTrustLevelDisplay).toBe('function');
  });

  it('should create TrustChecker instance', async () => {
    const { getTrustChecker } = await import('../trustChecker.js');
    const checker = getTrustChecker();
    expect(checker).toBeDefined();
    expect(typeof checker.checkDomain).toBe('function');
    expect(typeof checker.getAlertConfig).toBe('function');
  });
});

describe('TrustChecker - Phase 2 - Default Alert Config', () => {
  it('should have correct default alert config values', async () => {
    const { DEFAULT_ALERT_CONFIG } = await import('../trustChecker.js');
    expect(DEFAULT_ALERT_CONFIG.alertFinance).toBe(true);
    expect(DEFAULT_ALERT_CONFIG.alertSensitive).toBe(true);
    expect(DEFAULT_ALERT_CONFIG.alertUnverified).toBe(false);
    expect(DEFAULT_ALERT_CONFIG.saveAbortedPages).toBe(false);
  });
});

describe('TrustChecker - Phase 2 - Alert Settings Save/Load', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage.clear();
    setupChromeMocks();
  });

  it('should load default alert config when storage is empty', async () => {
    const { TrustChecker, DEFAULT_ALERT_CONFIG } = await import('../trustChecker.js');
    const checker = new TrustChecker();
    await checker.loadAlertSettings();

    const config = await checker.getAlertConfig();
    expect(config.alertFinance).toBe(DEFAULT_ALERT_CONFIG.alertFinance);
    expect(config.alertSensitive).toBe(DEFAULT_ALERT_CONFIG.alertSensitive);
    expect(config.alertUnverified).toBe(DEFAULT_ALERT_CONFIG.alertUnverified);
    expect(config.saveAbortedPages).toBe(DEFAULT_ALERT_CONFIG.saveAbortedPages);
  });

  it('should save and reflect alert config changes', async () => {
    const { TrustChecker } = await import('../trustChecker.js');
    const checker = new TrustChecker();
    await checker.loadAlertSettings();

    await checker.saveAlertSettings({ alertUnverified: true, saveAbortedPages: true });

    const config = await checker.getAlertConfig();
    expect(config.alertUnverified).toBe(true);
    expect(config.saveAbortedPages).toBe(true);
    expect(config.alertFinance).toBe(true);
    expect(config.alertSensitive).toBe(true);
  });

  it('should persist alert config to storage', async () => {
    const { TrustChecker } = await import('../trustChecker.js');
    const checker = new TrustChecker();
    await checker.loadAlertSettings();

    await checker.saveAlertSettings({ alertFinance: false });

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ 'alert_finance': false })
    );
  });

  it('shouldSaveAbortedPages should reflect saveAbortedPages setting', async () => {
    const { TrustChecker } = await import('../trustChecker.js');
    const checker = new TrustChecker();
    await checker.loadAlertSettings();

    expect(await checker.shouldSaveAbortedPages()).toBe(false);

    await checker.saveAlertSettings({ saveAbortedPages: true });
    expect(await checker.shouldSaveAbortedPages()).toBe(true);
  });

  it('shouldSaveAbortedPagesSync should return current config value', async () => {
    const { TrustChecker } = await import('../trustChecker.js');
    const checker = new TrustChecker();
    await checker.loadAlertSettings();

    expect(checker.shouldSaveAbortedPagesSync()).toBe(false);

    await checker.saveAlertSettings({ saveAbortedPages: true });
    expect(checker.shouldSaveAbortedPagesSync()).toBe(true);
  });

  it('should save alertSensitive setting', async () => {
    const { TrustChecker } = await import('../trustChecker.js');
    const checker = new TrustChecker();
    await checker.loadAlertSettings();

    await checker.saveAlertSettings({ alertSensitive: false });

    const config = await checker.getAlertConfig();
    expect(config.alertSensitive).toBe(false);
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ 'alert_sensitive': false })
    );
  });

  it('should not call storage.set when no config changes provided', async () => {
    const { TrustChecker } = await import('../trustChecker.js');
    const checker = new TrustChecker();
    await checker.loadAlertSettings();

    const setCallsBefore = (chrome.storage.local.set as jest.Mock).mock.calls.length;
    await checker.saveAlertSettings({});
    const setCallsAfter = (chrome.storage.local.set as jest.Mock).mock.calls.length;

    expect(setCallsAfter).toBe(setCallsBefore);
  });

  it('loadAlertSettings should handle storage errors and use defaults', async () => {
    const { TrustChecker, DEFAULT_ALERT_CONFIG } = await import('../trustChecker.js');
    const checker = new TrustChecker();

    // Override storage.get to throw for this test
    (chrome.storage.local.get as jest.Mock).mockRejectedValueOnce(new Error('Storage error'));

    await checker.loadAlertSettings();

    const config = await checker.getAlertConfig();
    expect(config.alertFinance).toBe(DEFAULT_ALERT_CONFIG.alertFinance);
    expect(config.alertSensitive).toBe(DEFAULT_ALERT_CONFIG.alertSensitive);
    expect(config.alertUnverified).toBe(DEFAULT_ALERT_CONFIG.alertUnverified);
    expect(config.saveAbortedPages).toBe(DEFAULT_ALERT_CONFIG.saveAbortedPages);
  });
});

describe('TrustChecker - Phase 2 - Safety Mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage.clear();
    setupChromeMocks();
  });

  it('getSafetyMode should return default balanced', async () => {
    const { TrustChecker } = await import('../trustChecker.js');
    const checker = new TrustChecker();
    const mode = await checker.getSafetyMode();
    expect(mode).toBe('balanced');
  });

  it('setSafetyMode should save mode and sync tranco tier', async () => {
    const { TrustChecker } = await import('../trustChecker.js');
    const checker = new TrustChecker();

    await checker.setSafetyMode('strict');

    expect(mockStorage.get('safety_mode')).toBe('strict');
    expect(mockStorage.get('tranco_tier')).toBe('top1k');
  });

  it('setSafetyMode relaxed should set top100k tier', async () => {
    const { TrustChecker } = await import('../trustChecker.js');
    const checker = new TrustChecker();

    await checker.setSafetyMode('relaxed');

    expect(mockStorage.get('tranco_tier')).toBe('top100k');
  });

  it('setSafetyMode balanced should set top10k tier', async () => {
    const { TrustChecker } = await import('../trustChecker.js');
    const checker = new TrustChecker();

    await checker.setSafetyMode('balanced');

    expect(mockStorage.get('tranco_tier')).toBe('top10k');
  });

  it('getTrancoTier should return default top10k', async () => {
    const { TrustChecker } = await import('../trustChecker.js');
    const checker = new TrustChecker();
    const tier = await checker.getTrancoTier();
    expect(tier).toBe('top10k');
  });

  it('getSafetyMode should return stored value', async () => {
    mockStorage.set('safety_mode', 'strict');
    const { TrustChecker } = await import('../trustChecker.js');
    const checker = new TrustChecker();
    const mode = await checker.getSafetyMode();
    expect(mode).toBe('strict');
  });

  it('getTrancoTier should return stored value', async () => {
    mockStorage.set('tranco_tier', 'top1k');
    const { TrustChecker } = await import('../trustChecker.js');
    const checker = new TrustChecker();
    const tier = await checker.getTrancoTier();
    expect(tier).toBe('top1k');
  });
});

describe('TrustChecker - Phase 2 - Singleton', () => {
  it('getTrustChecker should return singleton instance', async () => {
    const { getTrustChecker } = await import('../trustChecker.js');
    const checker1 = getTrustChecker();
    const checker2 = getTrustChecker();
    expect(checker1).toBe(checker2);
  });
});

describe('TrustChecker - Phase 2 - getAlertConfigSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage.clear();
    setupChromeMocks();
  });

  it('should warn when called before initialization', async () => {
    const { TrustChecker } = await import('../trustChecker.js');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const checker = new TrustChecker();
    (checker as any).alertConfigInitialized = false;
    const result = checker.getAlertConfigSync();

    expect(result._initialized).toBe(false);
    expect(typeof result.alertFinance).toBe('boolean');
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('should return initialized=true after loadAlertSettings completes', async () => {
    const { TrustChecker } = await import('../trustChecker.js');
    const checker = new TrustChecker();
    await checker.loadAlertSettings();

    const result = checker.getAlertConfigSync();
    expect(result._initialized).toBe(true);
  });

  it('shouldSaveAbortedPagesSync should warn before initialization', async () => {
    const { TrustChecker } = await import('../trustChecker.js');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const checker = new TrustChecker();
    (checker as any).alertConfigInitialized = false;
    const result = checker.shouldSaveAbortedPagesSync();

    expect(typeof result).toBe('boolean');
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});

describe('TrustChecker - Phase 2 - checkDomain', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage.clear();
    setupChromeMocks();
    mockDbInitialize.mockClear();
    mockIsDomainTrusted.mockReset();
  });

  it('should return canProceed=true for trusted domains', async () => {
    const { TrustChecker } = await import('../trustChecker.js');

    mockIsDomainTrusted.mockResolvedValue({
      level: 'trusted',
      source: 'jp-anchor',
      reason: 'JP-Anchor TLD',
      category: 'anchor'
    });

    const checker = new TrustChecker();
    await checker.loadAlertSettings();

    const result = await checker.checkDomain('https://example.go.jp');
    expect(result.canProceed).toBe(true);
    expect(result.showAlert).toBe(false);
    expect(result.trustResult.level).toBe('trusted');
    expect(result.reason).toBeUndefined();
  });

  it('should show alert for sensitive finance domain when alertFinance is enabled', async () => {
    const { TrustChecker } = await import('../trustChecker.js');

    mockIsDomainTrusted.mockResolvedValue({
      level: 'sensitive',
      source: 'sensitive-presets',
      reason: 'Finance domain',
      category: 'finance'
    });

    const checker = new TrustChecker();
    await checker.loadAlertSettings();

    const result = await checker.checkDomain('https://rakuten.co.jp');
    expect(result.showAlert).toBe(true);
    expect(result.canProceed).toBe(true);
  });

  it('should not show alert for sensitive finance domain when alertFinance is disabled', async () => {
    const { TrustChecker } = await import('../trustChecker.js');

    mockIsDomainTrusted.mockResolvedValue({
      level: 'sensitive',
      source: 'sensitive-presets',
      reason: 'Finance domain',
      category: 'finance'
    });

    const checker = new TrustChecker();
    await checker.loadAlertSettings();
    await checker.saveAlertSettings({ alertFinance: false });

    const result = await checker.checkDomain('https://rakuten.co.jp');
    expect(result.showAlert).toBe(false);
  });

  it('should show alert for sensitive non-finance domain when alertSensitive is enabled', async () => {
    const { TrustChecker } = await import('../trustChecker.js');

    mockIsDomainTrusted.mockResolvedValue({
      level: 'sensitive',
      source: 'sensitive-presets',
      reason: 'SNS domain',
      category: 'sns'
    });

    const checker = new TrustChecker();
    await checker.loadAlertSettings();

    const result = await checker.checkDomain('https://twitter.com');
    expect(result.showAlert).toBe(true);
  });

  it('should not show alert for sensitive non-finance domain when alertSensitive is disabled', async () => {
    const { TrustChecker } = await import('../trustChecker.js');

    mockIsDomainTrusted.mockResolvedValue({
      level: 'sensitive',
      source: 'sensitive-presets',
      reason: 'Gaming domain',
      category: 'gaming'
    });

    const checker = new TrustChecker();
    await checker.loadAlertSettings();
    await checker.saveAlertSettings({ alertSensitive: false });

    const result = await checker.checkDomain('https://nintendo.com');
    expect(result.showAlert).toBe(false);
  });

  it('should show alert for unverified domain when alertUnverified is enabled', async () => {
    const { TrustChecker } = await import('../trustChecker.js');

    mockIsDomainTrusted.mockResolvedValue({
      level: 'unverified',
      source: 'unknown',
      reason: 'Not in any list'
    });

    const checker = new TrustChecker();
    await checker.loadAlertSettings();
    await checker.saveAlertSettings({ alertUnverified: true });

    const result = await checker.checkDomain('https://random-site.xyz');
    expect(result.showAlert).toBe(true);
  });

  it('should not show alert for unverified domain when alertUnverified is disabled', async () => {
    const { TrustChecker } = await import('../trustChecker.js');

    mockIsDomainTrusted.mockResolvedValue({
      level: 'unverified',
      source: 'unknown',
      reason: 'Not in any list'
    });

    const checker = new TrustChecker();
    await checker.loadAlertSettings();

    // Default: alertUnverified = false
    const result = await checker.checkDomain('https://random-site.xyz');
    expect(result.showAlert).toBe(false);
  });

  it('should block recording for locked domains', async () => {
    const { TrustChecker } = await import('../trustChecker.js');

    mockIsDomainTrusted.mockResolvedValue({
      level: 'locked',
      source: 'user-blacklist',
      reason: 'User blocked'
    });

    const checker = new TrustChecker();
    await checker.loadAlertSettings();

    const result = await checker.checkDomain('https://blocked.example.com');
    expect(result.canProceed).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.reason).toContain('blocked');
  });

  it('should not show alert for sensitive domain without category (falls through)', async () => {
    const { TrustChecker } = await import('../trustChecker.js');

    mockIsDomainTrusted.mockResolvedValue({
      level: 'sensitive',
      source: 'user-blacklist',
      reason: 'Blacklisted'
    });

    const checker = new TrustChecker();
    await checker.loadAlertSettings();

    const result = await checker.checkDomain('https://blocked.example.com');
    expect(result.showAlert).toBe(false);
    expect(result.canProceed).toBe(true);
  });

  it('should return canProceed=true for non-locked domains', async () => {
    const { TrustChecker } = await import('../trustChecker.js');

    mockIsDomainTrusted.mockResolvedValue({
      level: 'trusted',
      source: 'tranco',
      reason: 'In Tranco list',
      category: 'tranco'
    });

    const checker = new TrustChecker();
    await checker.loadAlertSettings();

    const result = await checker.checkDomain('https://example.com');
    expect(result.canProceed).toBe(true);
  });
});

describe('TrustChecker - Phase 2 - getTrustLevelDisplay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage.clear();
    setupChromeMocks();
    mockDbInitialize.mockClear();
    mockIsDomainTrusted.mockReset();
  });

  it('should return trusted display for trusted domain', async () => {
    const { TrustChecker } = await import('../trustChecker.js');

    mockIsDomainTrusted.mockResolvedValue({
      level: 'trusted',
      source: 'jp-anchor',
      category: 'anchor'
    });

    const checker = new TrustChecker();
    const display = await checker.getTrustLevelDisplay('https://example.go.jp');
    expect(display.level).toBe('TRUSTED');
    expect(display.color).toBe('#10b981');
    expect(display.icon).toBe('🟢');
  });

  it('should return sensitive display for sensitive domain', async () => {
    const { TrustChecker } = await import('../trustChecker.js');

    mockIsDomainTrusted.mockResolvedValue({
      level: 'sensitive',
      source: 'sensitive-presets',
      category: 'finance'
    });

    const checker = new TrustChecker();
    const display = await checker.getTrustLevelDisplay('https://rakuten.co.jp');
    expect(display.level).toBe('SENSITIVE');
    expect(display.color).toBe('#f59e0b');
    expect(display.icon).toBe('🟡');
  });

  it('should return unverified display for unverified domain', async () => {
    const { TrustChecker } = await import('../trustChecker.js');

    mockIsDomainTrusted.mockResolvedValue({
      level: 'unverified',
      source: 'unknown'
    });

    const checker = new TrustChecker();
    const display = await checker.getTrustLevelDisplay('https://random-site.xyz');
    expect(display.level).toBe('UNVERIFIED');
    expect(display.color).toBe('#94a3b8');
    expect(display.icon).toBe('⚪');
  });

  it('should return locked display for locked domain', async () => {
    const { TrustChecker } = await import('../trustChecker.js');

    mockIsDomainTrusted.mockResolvedValue({
      level: 'locked',
      source: 'user-blacklist'
    });

    const checker = new TrustChecker();
    const display = await checker.getTrustLevelDisplay('https://blocked.example.com');
    expect(display.level).toBe('LOCKED');
    expect(display.color).toBe('#6b7280');
    expect(display.icon).toBe('🔒');
  });

  it('should fall back to unverified display for unknown level', async () => {
    const { TrustChecker } = await import('../trustChecker.js');

    mockIsDomainTrusted.mockResolvedValue({
      level: 'unknown_level',
      source: 'unknown'
    });

    const checker = new TrustChecker();
    const display = await checker.getTrustLevelDisplay('https://unknown.example.com');
    expect(display.level).toBe('UNKNOWN_LEVEL');
    expect(display.color).toBe('#94a3b8');
    expect(display.icon).toBe('⚪');
  });
});

describe('TrustChecker - Phase 2 - Convenience Functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage.clear();
    setupChromeMocks();
    mockDbInitialize.mockClear();
    mockIsDomainTrusted.mockReset();
  });

  it('checkDomainTrust should delegate to TrustChecker.checkDomain', async () => {
    const { checkDomainTrust } = await import('../trustChecker.js');

    mockIsDomainTrusted.mockResolvedValue({
      level: 'trusted',
      source: 'jp-anchor',
      category: 'anchor'
    });

    const result = await checkDomainTrust('https://example.go.jp');
    expect(result.canProceed).toBe(true);
    expect(result.trustResult.level).toBe('trusted');
  });

  it('getTrustLevelDisplay function should delegate to TrustChecker.getTrustLevelDisplay', async () => {
    const { getTrustLevelDisplay: getTrustLevelDisplayFn } = await import('../trustChecker.js');

    mockIsDomainTrusted.mockResolvedValue({
      level: 'trusted',
      source: 'tranco',
      category: 'tranco'
    });

    const display = await getTrustLevelDisplayFn('https://example.com');
    expect(display.level).toBe('TRUSTED');
    expect(display.color).toBe('#10b981');
  });
});
