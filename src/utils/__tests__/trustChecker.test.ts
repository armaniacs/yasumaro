/**
 * @jest-environment jsdom
 */

/**
 * trustChecker.test.ts
 * Unit tests for Trust Checker (Phase 2)
 * Alert settings and Trust check logic
 */

import { jest } from '@jest/globals';

// Mock chrome.storage.local
const mockStorage = new Map();
global.chrome = {
  storage: {
    local: {
      get: jest.fn().mockImplementation((keys, callback) => {
        const result: Record<string, unknown> = {};
        if (keys === undefined || keys === null) {
          return Promise.resolve(Object.fromEntries(mockStorage));
        }
        // objectの場合はdefault値付きで処理
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
      set: jest.fn().mockImplementation((items, callback) => {
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

describe('TrustChecker - Phase 2 - Module Loading', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage.clear();
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
    // 変更しなかった値は変わらない
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
});
