/**
 * navTrailConsent unit tests: the shape guard, the "enabled AND consented"
 * activation rule, and the round-trip through chrome.storage.local.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const localStore: Record<string, unknown> = {};
const mockGet = vi.fn();
const mockSet = vi.fn();

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: (key: string) => {
        mockGet(key);
        return Promise.resolve(key in localStore ? { [key]: localStore[key] } : {});
      },
      set: (obj: Record<string, unknown>) => {
        mockSet(obj);
        Object.assign(localStore, obj);
        return Promise.resolve();
      },
    },
  },
});

import {
  NAV_TRAIL_CONSENT_DEFAULT,
  disableNavTrail,
  enableNavTrail,
  getNavTrailConsent,
  isNavTrailActive,
} from '../navTrailConsent.js';
import { StorageKeys } from '../types.js';

describe('navTrailConsent', () => {
  beforeEach(() => {
    for (const key of Object.keys(localStore)) delete localStore[key];
    mockGet.mockReset();
    mockSet.mockReset();
  });

  it('defaults to off when nothing is stored', async () => {
    expect(await getNavTrailConsent()).toEqual(NAV_TRAIL_CONSENT_DEFAULT);
    expect(NAV_TRAIL_CONSENT_DEFAULT).toEqual({ enabled: false, consentedAt: null });
  });

  it('round-trips an enabled consent', async () => {
    await enableNavTrail(1234);

    expect(await getNavTrailConsent()).toEqual({ enabled: true, consentedAt: 1234 });
  });

  it('round-trips a disable back to the default', async () => {
    await enableNavTrail(1234);
    await disableNavTrail();

    expect(await getNavTrailConsent()).toEqual(NAV_TRAIL_CONSENT_DEFAULT);
  });

  it('is active only when enabled and carrying a timestamp', () => {
    expect(isNavTrailActive({ enabled: true, consentedAt: 1 })).toBe(true);
    expect(isNavTrailActive({ enabled: true, consentedAt: null })).toBe(false);
    expect(isNavTrailActive({ enabled: false, consentedAt: 1 })).toBe(false);
    expect(isNavTrailActive({ enabled: false, consentedAt: null })).toBe(false);
  });

  it.each([
    ['a bare string', 'yes'],
    ['null', null],
    ['an array', []],
    ['a non-boolean enabled', { enabled: 'true', consentedAt: 1 }],
    ['a string timestamp', { enabled: true, consentedAt: '1234' }],
    ['an object timestamp', { enabled: true, consentedAt: {} }],
  ])('falls back to the default for %s', async (_label, stored) => {
    localStore[StorageKeys.NAV_TRAIL_CONSENT] = stored;

    expect(await getNavTrailConsent()).toEqual(NAV_TRAIL_CONSENT_DEFAULT);
  });

  it('falls back to the default when storage throws', async () => {
    mockGet.mockImplementationOnce(() => Promise.reject(new Error('quota')));

    expect(await getNavTrailConsent()).toEqual(NAV_TRAIL_CONSENT_DEFAULT);
  });
});
