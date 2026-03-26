/**
 * @jest-environment jsdom
 */

/**
 * trancoConsentManager.test.ts
 * Unit tests for TrancoConsentManager (Phase 3)
 */

import { jest } from '@jest/globals';
import { TrancoConsentManager, ConsentResult } from '../trancoConsentManager.js';
import { StorageKeys } from '../../storage.js';

beforeAll(() => {
  jest.useFakeTimers();
});

afterAll(() => {
  jest.useRealTimers();
});

// Mock chrome.storage.local
const mockStorage = new Map<string, any>();

const mockChromeStorage = {
  local: {
    get: jest.fn().mockImplementation((keys) => {
      const result: Record<string, any> = {};
      for (const key of keys) {
        if (mockStorage.has(key)) {
          result[key] = mockStorage.get(key);
        }
      }
      return Promise.resolve(result);
    }),
    set: jest.fn().mockImplementation((items) => {
      for (const [key, value] of Object.entries(items)) {
        mockStorage.set(key, value);
      }
      return Promise.resolve();
    }),
    remove: jest.fn().mockImplementation((keys) => {
      for (const key of keys) {
        mockStorage.delete(key);
      }
      return Promise.resolve();
    })
  }
};

Object.defineProperty(global, 'chrome', {
  value: {
    storage: mockChromeStorage
  },
  writable: true
});

describe('TrancoConsentManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    mockStorage.clear();
    jest.setSystemTime(new Date('2026-03-26'));

    // Mock chrome.storage.local.get to handle array keys correctly
    mockChromeStorage.local.get.mockImplementation(async (keys) => {
      const result: Record<string, any> = {};
      if (Array.isArray(keys)) {
        for (const key of keys) {
          if (mockStorage.has(key)) {
            result[key] = mockStorage.get(key);
          } else {
            result[key] = null;
          }
        }
      } else if (typeof keys === 'string') {
        if (mockStorage.has(keys)) {
          result[keys] = mockStorage.get(keys);
        } else {
          result[keys] = null;
        }
      } else if (typeof keys === 'object' && keys !== null) {
        // Handle { key: defaultValue } format
        for (const [key, defaultValue] of Object.entries(keys)) {
          if (mockStorage.has(key)) {
            result[key] = mockStorage.get(key);
          } else {
            result[key] = defaultValue;
          }
        }
      }
      return result;
    });
  });

  describe('needsConsent', () => {
    it('should return PENDING for first-time consent', async () => {
      const result = await TrancoConsentManager.needsConsent('2026-03-26');

      expect(result).toBe(ConsentResult.PENDING);
    });

    it('should return ALREADY_GRANTED for same version', async () => {
      mockStorage.set(StorageKeys.TRANCO_CONSENT_GRANTED, '2026-03-26');

      const result = await TrancoConsentManager.needsConsent('2026-03-26');

      expect(result).toBe(ConsentResult.ALREADY_GRANTED);
    });

    it('should return PENDING for new version after previous grant', async () => {
      mockStorage.set(StorageKeys.TRANCO_CONSENT_GRANTED, '2026-03-01');

      const result = await TrancoConsentManager.needsConsent('2026-03-26');

      expect(result).toBe(ConsentResult.PENDING);
    });

    it('should return DENIED within 30 days after denial', async () => {
      const tenDaysAgo = Date.now() - (10 * 24 * 60 * 60 * 1000);
      mockStorage.set(StorageKeys.TRANCO_CONSENT_DENIED_TIMESTAMP, tenDaysAgo);

      const result = await TrancoConsentManager.needsConsent('2026-03-26');

      expect(result).toBe(ConsentResult.DENIED);
    });

    it('should return RETRY_NEEDED after 30 days from denial', async () => {
      const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
      mockStorage.set(StorageKeys.TRANCO_CONSENT_DENIED_TIMESTAMP, thirtyDaysAgo);

      const result = await TrancoConsentManager.needsConsent('2026-03-26');

      expect(result).toBe(ConsentResult.RETRY_NEEDED);
    });

    it('should return RETRY_NEEDED after more than 30 days', async () => {
      const thirtyOneDaysAgo = Date.now() - (31 * 24 * 60 * 60 * 1000);
      mockStorage.set(StorageKeys.TRANCO_CONSENT_DENIED_TIMESTAMP, thirtyOneDaysAgo);

      const result = await TrancoConsentManager.needsConsent('2026-03-26');

      expect(result).toBe(ConsentResult.RETRY_NEEDED);
    });

    it('should prioritize current grant over denial', async () => {
      mockStorage.set(StorageKeys.TRANCO_CONSENT_GRANTED, '2026-03-26');
      mockStorage.set(StorageKeys.TRANCO_CONSENT_DENIED_TIMESTAMP, Date.now());

      const result = await TrancoConsentManager.needsConsent('2026-03-26');

      expect(result).toBe(ConsentResult.ALREADY_GRANTED);
    });
  });

  describe('recordConsent', () => {
    it('should record granted consent', async () => {
      await TrancoConsentManager.recordConsent('2026-03-26', 'grant');

      expect(mockStorage.get('tranco_consent_granted')).toBe('2026-03-26');
      expect(mockStorage.get('tranco_consent_denied_reason')).toBe(null);
      expect(mockStorage.get('tranco_consent_denied_timestamp')).toBe(null);
    });

    it('should record denied consent', async () => {
      await TrancoConsentManager.recordConsent('2026-03-26', 'deny');

      expect(mockStorage.get('tranco_consent_granted')).toBe(null);
      expect(mockStorage.get('tranco_consent_denied_reason')).toBe('deny');
      expect(mockStorage.get('tranco_consent_denied_timestamp')).toBe(Date.now());
    });

    it('should record retry_later consent', async () => {
      await TrancoConsentManager.recordConsent('2026-03-26', 'retry_later');

      expect(mockStorage.get('tranco_consent_granted')).toBe(null);
      expect(mockStorage.get('tranco_consent_denied_reason')).toBe('retry_later');
      expect(mockStorage.get('tranco_consent_denied_timestamp')).toBe(Date.now());
    });

    it('should grant consent when no reason provided', async () => {
      await TrancoConsentManager.recordConsent('2026-03-26');

      expect(mockStorage.get('tranco_consent_granted')).toBe('2026-03-26');
    });

    it('should overwrite previous consent', async () => {
      // First grant consent
      await TrancoConsentManager.recordConsent('2026-03-26', 'grant');

      // Then deny
      await TrancoConsentManager.recordConsent('2026-03-26', 'deny');

      expect(mockStorage.get('tranco_consent_granted')).toBe(null);
      expect(mockStorage.get('tranco_consent_denied_reason')).toBe('deny');
    });
  });

  describe('saveOldTrancoDomains', () => {
    it('should save old Tranco domains', async () => {
      const domains = ['google.com', 'facebook.com', 'twitter.com'];

      await TrancoConsentManager.saveOldTrancoDomains(domains);

      expect(mockStorage.get(StorageKeys.TRANCO_DOMAINS)).toEqual(domains);
    });

    it('should save empty domains list', async () => {
      const domains: string[] = [];

      await TrancoConsentManager.saveOldTrancoDomains(domains);

      expect(mockStorage.get(StorageKeys.TRANCO_DOMAINS)).toEqual([]);
    });
  });

  describe('getOldTrancoDomains', () => {
    it('should retrieve saved old domains', async () => {
      const domains = ['google.com', 'facebook.com'];
      mockStorage.set(StorageKeys.TRANCO_DOMAINS, domains);

      const result = await TrancoConsentManager.getOldTrancoDomains();

      expect(result).toEqual(domains);
    });

    it('should return empty array when no domains saved', async () => {
      const result = await TrancoConsentManager.getOldTrancoDomains();

      expect(result).toEqual([]);
    });
  });

  describe('clearOldTrancoDomains', () => {
    it('should clear saved old domains', async () => {
      mockStorage.set(StorageKeys.TRANCO_DOMAINS, ['google.com', 'facebook.com']);

      await TrancoConsentManager.clearOldTrancoDomains();

      expect(mockStorage.has(StorageKeys.TRANCO_DOMAINS)).toBe(false);
      expect(mockChromeStorage.local.remove).toHaveBeenCalledWith([StorageKeys.TRANCO_DOMAINS]);
    });
  });

  describe('getDeniedReason', () => {
    it('should retrieve denied reason', async () => {
      mockStorage.set(StorageKeys.TRANCO_CONSENT_DENIED_REASON, 'deny');

      const result = await TrancoConsentManager.getDeniedReason();

      expect(result).toBe('deny');
    });

    it('should return null when no denied reason', async () => {
      const result = await TrancoConsentManager.getDeniedReason();

      expect(result).toBe(null);
    });
  });

  describe('getRetryDaysRemaining', () => {
    it('should return null when denial not present', async () => {
      const result = await TrancoConsentManager.getRetryDaysRemaining();

      expect(result).toBe(null);
    });

    it('should calculate remaining days correctly', async () => {
      const tenDaysAgo = Date.now() - (10 * 24 * 60 * 60 * 1000);
      mockStorage.set(StorageKeys.TRANCO_CONSENT_DENIED_TIMESTAMP, tenDaysAgo);

      const result = await TrancoConsentManager.getRetryDaysRemaining();

      // 30 - 10 = 20 days remaining
      expect(result).toBe(20);
    });

    it('should return 0 when 30 days have passed', async () => {
      const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
      mockStorage.set(StorageKeys.TRANCO_CONSENT_DENIED_TIMESTAMP, thirtyDaysAgo);

      const result = await TrancoConsentManager.getRetryDaysRemaining();

      expect(result).toBe(0);
    });

    it('should round up remaining days', async () => {
      const tenAndHalfDaysAgo = Date.now() - (10.5 * 24 * 60 * 60 * 1000);
      mockStorage.set(StorageKeys.TRANCO_CONSENT_DENIED_TIMESTAMP, tenAndHalfDaysAgo);

      const result = await TrancoConsentManager.getRetryDaysRemaining();

      expect(result).toBe(20); // Should round up
    });

    it('should return 0 for negative remaining days', async () => {
      const fiftyDaysAgo = Date.now() - (50 * 24 * 60 * 60 * 1000);
      mockStorage.set(StorageKeys.TRANCO_CONSENT_DENIED_TIMESTAMP, fiftyDaysAgo);

      const result = await TrancoConsentManager.getRetryDaysRemaining();

      expect(result).toBe(0); // Should cap at 0
    });
  });

  describe('resetConsent', () => {
    it('should clear consent state', async () => {
      mockStorage.set(StorageKeys.TRANCO_CONSENT_GRANTED, '2026-03-26');
      mockStorage.set(StorageKeys.TRANCO_CONSENT_DENIED_REASON, 'deny');
      mockStorage.set(StorageKeys.TRANCO_CONSENT_DENIED_TIMESTAMP, Date.now());

      await TrancoConsentManager.resetConsent();

      expect(mockStorage.has(StorageKeys.TRANCO_CONSENT_GRANTED)).toBe(false);
      expect(mockStorage.has(StorageKeys.TRANCO_CONSENT_DENIED_REASON)).toBe(false);
      expect(mockStorage.has(StorageKeys.TRANCO_CONSENT_DENIED_TIMESTAMP)).toBe(false);
    });

    it('should only clear consent keys', async () => {
      mockStorage.set(StorageKeys.TRANCO_CONSENT_GRANTED, '2026-03-26');
      mockStorage.set(StorageKeys.TRANCO_DOMAINS, ['google.com']);

      await TrancoConsentManager.resetConsent();

      expect(mockStorage.has(StorageKeys.TRANCO_CONSENT_GRANTED)).toBe(false);
      expect(mockStorage.has(StorageKeys.TRANCO_DOMAINS)).toBe(true); // Should not be cleared
    });
  });

  describe('resetAll', () => {
    it('should clear all Tranco-related state', async () => {
      mockStorage.set(StorageKeys.TRANCO_CONSENT_GRANTED, '2026-03-26');
      mockStorage.set(StorageKeys.TRANCO_CONSENT_DENIED_REASON, 'deny');
      mockStorage.set(StorageKeys.TRANCO_CONSENT_DENIED_TIMESTAMP, Date.now());
      mockStorage.set(StorageKeys.TRANCO_DOMAINS, ['google.com']);

      await TrancoConsentManager.resetAll();

      expect(mockStorage.has(StorageKeys.TRANCO_CONSENT_GRANTED)).toBe(false);
      expect(mockStorage.has(StorageKeys.TRANCO_CONSENT_DENIED_REASON)).toBe(false);
      expect(mockStorage.has(StorageKeys.TRANCO_CONSENT_DENIED_TIMESTAMP)).toBe(false);
      expect(mockStorage.has(StorageKeys.TRANCO_DOMAINS)).toBe(false);
    });
  });

  describe('getCurrentState', () => {
    it('should return current state with granted consent', async () => {
      mockStorage.set(StorageKeys.TRANCO_CONSENT_GRANTED, '2026-03-01');

      const state = await TrancoConsentManager.getCurrentState('2026-03-26');

      expect(state.grantedVersion).toBe('2026-03-01');
      expect(state.deniedReason).toBe(null);
      expect(state.deniedTimestamp).toBe(null);
      expect(state.retryDaysRemaining).toBe(null);
      expect(state.needsConsent).toBe(ConsentResult.PENDING);
    });

    it('should return current state with denied consent', async () => {
      const tenDaysAgo = Date.now() - (10 * 24 * 60 * 60 * 1000);
      mockStorage.set(StorageKeys.TRANCO_CONSENT_DENIED_REASON, 'deny');
      mockStorage.set(StorageKeys.TRANCO_CONSENT_DENIED_TIMESTAMP, tenDaysAgo);

      const state = await TrancoConsentManager.getCurrentState('2026-03-26');

      expect(state.grantedVersion).toBe(null);
      expect(state.deniedReason).toBe('deny');
      expect(state.deniedTimestamp).toBe(tenDaysAgo);
      expect(state.retryDaysRemaining).toBe(20);
      expect(state.needsConsent).toBe(ConsentResult.DENIED);
    });

    it('should return empty state when no consent recorded', async () => {
      const state = await TrancoConsentManager.getCurrentState('2026-03-26');

      expect(state.grantedVersion).toBe(null);
      expect(state.deniedReason).toBe(null);
      expect(state.deniedTimestamp).toBe(null);
      expect(state.retryDaysRemaining).toBe(null);
      expect(state.needsConsent).toBe(ConsentResult.PENDING);
    });

    it('should return ALREADY_GRANTED for same version', async () => {
      mockStorage.set(StorageKeys.TRANCO_CONSENT_GRANTED, '2026-03-26');

      const state = await TrancoConsentManager.getCurrentState('2026-03-26');

      expect(state.needsConsent).toBe(ConsentResult.ALREADY_GRANTED);
    });
  });

  describe('ConsentResult enum', () => {
    it('should have correct enum values', () => {
      expect(ConsentResult.GRANTED).toBe('GRANTED');
      expect(ConsentResult.DENIED).toBe('DENIED');
      expect(ConsentResult.PENDING).toBe('PENDING');
      expect(ConsentResult.ALREADY_GRANTED).toBe('ALREADY_GRANTED');
      expect(ConsentResult.RETRY_NEEDED).toBe('RETRY_NEEDED');
    });
  });
});