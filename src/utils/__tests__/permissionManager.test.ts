/**
 * @jest-environment jsdom
 */

/**
 * permissionManager.test.ts
 * Unit tests for Permission Manager (P0)
 * Host permissions check and denied domain tracking
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
  },
  permissions: {
    contains: jest.fn(),
    request: jest.fn()
  }
} as any;

describe('PermissionManager - P0 - Module Loading', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage.clear();
  });

  it('should permissionManager module be loadable', async () => {
    const permissionManagerModule = await import('../permissionManager.js');
    expect(permissionManagerModule).toBeDefined();
    expect(typeof permissionManagerModule.getPermissionManager).toBe('function');
    expect(typeof permissionManagerModule.isHostPermitted).toBe('function');
    expect(typeof permissionManagerModule.requestPermission).toBe('function');
    expect(typeof permissionManagerModule.recordDeniedVisit).toBe('function');
  });

  it('should create PermissionManager instance', async () => {
    const { getPermissionManager } = await import('../permissionManager.js');
    const manager = getPermissionManager();
    expect(manager).toBeDefined();
    expect(typeof manager.isHostPermitted).toBe('function');
    expect(typeof manager.requestPermission).toBe('function');
    expect(typeof manager.recordDeniedVisit).toBe('function');
  });

  it('should return same singleton instance', async () => {
    const { getPermissionManager } = await import('../permissionManager.js');
    const manager1 = getPermissionManager();
    const manager2 = getPermissionManager();
    expect(manager1).toBe(manager2);
  });
});

describe('PermissionManager - P0 - isHostPermitted', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage.clear();
  });

  it('should return true when host is permitted', async () => {
    (chrome.permissions.contains as jest.Mock).mockResolvedValue(true);
    const { getPermissionManager } = await import('../permissionManager.js');
    const manager = getPermissionManager();

    const result = await manager.isHostPermitted('https://example.com/path');
    expect(result).toBe(true);
    expect(chrome.permissions.contains).toHaveBeenCalledWith({
      origins: ['*://example.com/*']
    });
  });

  it('should return false when host is not permitted', async () => {
    (chrome.permissions.contains as jest.Mock).mockResolvedValue(false);
    const { getPermissionManager } = await import('../permissionManager.js');
    const manager = getPermissionManager();

    const result = await manager.isHostPermitted('https://example.com/path');
    expect(result).toBe(false);
    expect(chrome.permissions.contains).toHaveBeenCalledWith({
      origins: ['*://example.com/*']
    });
  });

  it('should return false on permission check error', async () => {
    (chrome.permissions.contains as jest.Mock).mockRejectedValue(new Error('API error'));
    const { getPermissionManager } = await import('../permissionManager.js');
    const manager = getPermissionManager();

    const result = await manager.isHostPermitted('https://example.com/path');
    expect(result).toBe(false);
  });

  it('should handle invalid URL gracefully', async () => {
    const { getPermissionManager } = await import('../permissionManager.js');
    const manager = getPermissionManager();

    const result = await manager.isHostPermitted('invalid-url');
    expect(result).toBe(false);
    expect(chrome.permissions.contains).not.toHaveBeenCalled();
  });
});

describe('PermissionManager - P0 - requestPermission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage.clear();
  });

  it('should return true when permission is granted', async () => {
    (chrome.permissions.request as jest.Mock).mockResolvedValue(true);
    const { getPermissionManager } = await import('../permissionManager.js');
    const manager = getPermissionManager();

    const result = await manager.requestPermission('https://example.com/path');
    expect(result).toBe(true);
    expect(chrome.permissions.request).toHaveBeenCalledWith({
      origins: ['*://example.com/*']
    });
  });

  it('should return false when permission is denied', async () => {
    (chrome.permissions.request as jest.Mock).mockResolvedValue(false);
    const { getPermissionManager } = await import('../permissionManager.js');
    const manager = getPermissionManager();

    const result = await manager.requestPermission('https://example.com/path');
    expect(result).toBe(false);
  });

  it('should return false on request error', async () => {
    (chrome.permissions.request as jest.Mock).mockRejectedValue(new Error('API error'));
    const { getPermissionManager } = await import('../permissionManager.js');
    const manager = getPermissionManager();

    const result = await manager.requestPermission('https://example.com/path');
    expect(result).toBe(false);
  });
});

describe('PermissionManager - P0 - recordDeniedVisit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage.clear();
  });

  it('should create new entry for first denial', async () => {
    mockStorage.set('denied_domains', {});
    const { getPermissionManager } = await import('../permissionManager.js');
    const manager = getPermissionManager();

    await manager.recordDeniedVisit('example.com');

    const stored = mockStorage.get('denied_domains');
    expect(stored).toEqual({
      'example.com': {
        count: 1,
        lastDenied: expect.any(String),
        lastDismissed: undefined
      }
    });
  });

  it('should increment count for repeated denial', async () => {
    const oldTimestamp = new Date(Date.now() - 60000).toISOString();
    mockStorage.set('denied_domains', {
      'example.com': {
        count: 2,
        lastDenied: oldTimestamp,
        lastDismissed: undefined
      }
    });
    const { getPermissionManager } = await import('../permissionManager.js');
    const manager = getPermissionManager();

    await manager.recordDeniedVisit('example.com');

    const stored = mockStorage.get('denied_domains');
    expect(stored['example.com'].count).toBe(3);
    expect(stored['example.com'].lastDenied).not.toBe(oldTimestamp);
  });

  it('should handle multiple domains independently', async () => {
    mockStorage.set('denied_domains', {});
    const { getPermissionManager } = await import('../permissionManager.js');
    const manager = getPermissionManager();

    await manager.recordDeniedVisit('example.com');
    await manager.recordDeniedVisit('another.com');
    await manager.recordDeniedVisit('example.com');

    const stored = mockStorage.get('denied_domains');
    expect(stored['example.com'].count).toBe(2);
    expect(stored['another.com'].count).toBe(1);
  });
});

describe('PermissionManager - P0 - recordDomainDismissal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage.clear();
  });

  it('should set lastDismissed for existing domain', async () => {
    const baseTime = new Date(Date.now() - 86400000).toISOString();
    mockStorage.set('denied_domains', {
      'example.com': {
        count: 5,
        lastDenied: baseTime,
        lastDismissed: undefined
      }
    });
    const { getPermissionManager } = await import('../permissionManager.js');
    const manager = getPermissionManager();

    await manager.recordDomainDismissal('example.com');

    const stored = mockStorage.get('denied_domains');
    expect(stored['example.com'].lastDismissed).toBeDefined();
    expect(stored['example.com'].count).toBe(5); // 保持
  });

  it('should not create entry for non-existent domain', async () => {
    mockStorage.set('denied_domains', {});
    const { getPermissionManager } = await import('../permissionManager.js');
    const manager = getPermissionManager();

    await manager.recordDomainDismissal('nonexistent.com');

    const stored = mockStorage.get('denied_domains');
    expect(stored).toEqual({});
  });
});

describe('PermissionManager - P0 - cleanupOldDeniedEntries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage.clear();
  });

  it('should remove entries older than 90 days', async () => {
    const now = Date.now();
    const oldTime = new Date(now - (91 * 24 * 60 * 60 * 1000)).toISOString();
    const recentTime = new Date(now - (10 * 24 * 60 * 60 * 1000)).toISOString();

    mockStorage.set('denied_domains', {
      'old.com': {
        count: 10,
        lastDenied: oldTime,
        lastDismissed: undefined
      },
      'recent.com': {
        count: 5,
        lastDenied: recentTime,
        lastDismissed: undefined
      }
    });
    const { getPermissionManager } = await import('../permissionManager.js');
    const manager = getPermissionManager();

    await manager.cleanupOldDeniedEntries(90);

    const stored = mockStorage.get('denied_domains');
    expect(stored['old.com']).toBeUndefined();
    expect(stored['recent.com']).toBeDefined();
  });

  it('should clean all if all entries are old', async () => {
    const oldTime = new Date(Date.now() - (100 * 24 * 60 * 60 * 1000)).toISOString();

    mockStorage.set('denied_domains', {
      'old1.com': { count: 5, lastDenied: oldTime, lastDismissed: undefined },
      'old2.com': { count: 3, lastDenied: oldTime, lastDismissed: undefined }
    });
    const { getPermissionManager } = await import('../permissionManager.js');
    const manager = getPermissionManager();

    await manager.cleanupOldDeniedEntries(90);

    const stored = mockStorage.get('denied_domains');
    expect(stored).toEqual({});
  });
});

describe('PermissionManager - P0 - getFrequentDeniedDomains', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage.clear();
  });

  it('should return domains above default threshold (3)', async () => {
    mockStorage.set('denied_domains', {
      'frequent.com': {
        count: 5,
        lastDenied: new Date().toISOString(),
        lastDismissed: undefined
      },
      'rare.com': {
        count: 2,
        lastDenied: new Date().toISOString(),
        lastDismissed: undefined
      }
    });
    const { getPermissionManager } = await import('../permissionManager.js');
    const manager = getPermissionManager();

    const result = await manager.getFrequentDeniedDomains();

    expect(result).toHaveLength(1);
    expect(result[0].domain).toBe('frequent.com');
    expect(result[0].count).toBe(5);
  });

  it('should respect custom threshold', async () => {
    mockStorage.set('denied_domains', {
      'high.com': { count: 8, lastDenied: new Date().toISOString(), lastDismissed: undefined },
      'mid.com': { count: 5, lastDenied: new Date().toISOString(), lastDismissed: undefined },
      'low.com': { count: 2, lastDenied: new Date().toISOString(), lastDismissed: undefined }
    });
    const { getPermissionManager } = await import('../permissionManager.js');
    const manager = getPermissionManager();

    const result = await manager.getFrequentDeniedDomains(5);

    expect(result).toHaveLength(1);
    expect(result[0].domain).toBe('high.com');
  });

  it('should exclude domains dismissed within 14 days', async () => {
    const recentDismissal = new Date(Date.now() - (1 * 24 * 60 * 60 * 1000)).toISOString();
    const oldDismissal = new Date(Date.now() - (20 * 24 * 60 * 60 * 1000)).toISOString();

    mockStorage.set('denied_domains', {
      'dismissed.com': {
        count: 5,
        lastDenied: new Date().toISOString(),
        lastDismissed: recentDismissal
      },
      'expired-dismissal.com': {
        count: 5,
        lastDenied: new Date().toISOString(),
        lastDismissed: oldDismissal
      },
      'active.com': {
        count: 5,
        lastDenied: new Date().toISOString(),
        lastDismissed: undefined
      }
    });
    const { getPermissionManager } = await import('../permissionManager.js');
    const manager = getPermissionManager();

    const result = await manager.getFrequentDeniedDomains();

    expect(result).toHaveLength(2);
    expect(result.some(r => r.domain === 'active.com')).toBe(true);
    expect(result.some(r => r.domain === 'expired-dismissal.com')).toBe(true);
    expect(result.some(r => r.domain === 'dismissed.com')).toBe(false);
  });

  it('should return entries sorted by count descending', async () => {
    mockStorage.set('denied_domains', {
      'medium.com': { count: 5, lastDenied: new Date().toISOString(), lastDismissed: undefined },
      'high.com': { count: 10, lastDenied: new Date().toISOString(), lastDismissed: undefined },
      'low.com': { count: 8, lastDenied: new Date().toISOString(), lastDismissed: undefined }
    });
    const { getPermissionManager } = await import('../permissionManager.js');
    const manager = getPermissionManager();

    const result = await manager.getFrequentDeniedDomains();

    expect(result[0].domain).toBe('high.com');
    expect(result[1].domain).toBe('low.com');
    expect(result[2].domain).toBe('medium.com');
  });

  it('should clamp threshold to 1-50 range', async () => {
    mockStorage.set('denied_domains', {
      'fifty_one.com': { count: 51, lastDenied: new Date().toISOString(), lastDismissed: undefined },
      'five.com': { count: 5, lastDenied: new Date().toISOString(), lastDismissed: undefined },
      'one.com': { count: 1, lastDenied: new Date().toISOString(), lastDismissed: undefined }
    });
    const { getPermissionManager } = await import('../permissionManager.js');
    const manager = getPermissionManager();

    const resultLow = await manager.getFrequentDeniedDomains(-5);
    expect(resultLow).toHaveLength(2); // -5 → 1, count > 1 (five.com + fifty_one.com)

    const resultHigh = await manager.getFrequentDeniedDomains(100);
    expect(resultHigh).toHaveLength(1); // 100 → 50, count > 50 (fifty_one.com only)
  });
});

describe('PermissionManager - P0 - removeDeniedDomain', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage.clear();
  });

  it('should remove existing domain from denied list', async () => {
    mockStorage.set('denied_domains', {
      'example.com': {
        count: 5,
        lastDenied: new Date().toISOString(),
        lastDismissed: undefined
      }
    });
    const { getPermissionManager } = await import('../permissionManager.js');
    const manager = getPermissionManager();

    await manager.removeDeniedDomain('example.com');

    const stored = mockStorage.get('denied_domains');
    expect(stored['example.com']).toBeUndefined();
  });

  it('should not affect non-existent domain', async () => {
    mockStorage.set('denied_domains', {
      'other.com': { count: 3, lastDenied: new Date().toISOString(), lastDismissed: undefined }
    });
    const { getPermissionManager } = await import('../permissionManager.js');
    const manager = getPermissionManager();

    await manager.removeDeniedDomain('nonexistent.com');

    const stored = mockStorage.get('denied_domains');
    expect(stored['other.com']).toBeDefined();
  });
});

describe('PermissionManager - P0 - Utility Functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage.clear();
  });

  it('isAllUrlsPermitted should check <all_urls> permission', async () => {
    (chrome.permissions.contains as jest.Mock).mockResolvedValue(true);
    const { isAllUrlsPermitted } = await import('../permissionManager.js');

    const result = await isAllUrlsPermitted();
    expect(result).toBe(true);
    expect(chrome.permissions.contains).toHaveBeenCalledWith({
      origins: ['<all_urls>']
    });
  });

  it('requestAllUrls should request <all_urls> permission', async () => {
    (chrome.permissions.request as jest.Mock).mockResolvedValue(true);
    const { requestAllUrls } = await import('../permissionManager.js');

    const result = await requestAllUrls();
    expect(result).toBe(true);
    expect(chrome.permissions.request).toHaveBeenCalledWith({
      origins: ['<all_urls>']
    });
  });
});