/**
 * navTrailTracker unit tests: the per-tab referrer map, the consent gate, and
 * the field resolution (excluded domain → origin, PII mask on the query).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetNavTrailConsent = vi.fn();
const mockIsDomainAllowed = vi.fn();
const mockSanitizeRegex = vi.fn();
const mockSessionGet = vi.fn();
const mockSessionSet = vi.fn();
const mockSessionRemove = vi.fn();
const mockLocalGet = vi.fn();
const mockLocalSet = vi.fn();
const mockStorageOnChanged = vi.fn();

vi.mock('../../../utils/storage/navTrailConsent.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/storage/navTrailConsent.js')>();
  return {
    ...actual,
    getNavTrailConsent: (...args: unknown[]) => mockGetNavTrailConsent(...args),
  };
});

vi.mock('../../../utils/domainUtils.js', () => ({
  isDomainAllowed: (...args: unknown[]) => mockIsDomainAllowed(...args),
}));

vi.mock('../../../utils/piiSanitizer.js', () => ({
  sanitizeRegex: (...args: unknown[]) => mockSanitizeRegex(...args),
}));

const sessionStore: Record<string, unknown> = {};
const localStore: Record<string, unknown> = {};

vi.stubGlobal('chrome', {
  storage: {
    session: {
      get: (key: string) => {
        mockSessionGet(key);
        return Promise.resolve(key in sessionStore ? { [key]: sessionStore[key] } : {});
      },
      set: (obj: Record<string, unknown>) => {
        mockSessionSet(obj);
        Object.assign(sessionStore, obj);
        return Promise.resolve();
      },
      remove: (key: string) => {
        mockSessionRemove(key);
        delete sessionStore[key];
        return Promise.resolve();
      },
    },
    local: {
      get: (key: string) => {
        mockLocalGet(key);
        return Promise.resolve(key in localStore ? { [key]: localStore[key] } : {});
      },
      set: (obj: Record<string, unknown>) => {
        mockLocalSet(obj);
        Object.assign(localStore, obj);
        return Promise.resolve();
      },
    },
    onChanged: { addListener: (fn: unknown) => mockStorageOnChanged(fn) },
  },
});

import {
  NAV_TRAIL_SESSION_KEY,
  clearAllNavTrail,
  getNavSource,
  onTabRemoved,
  onTabUrlChanged,
  registerNavTrailConsentWatcher,
  resolveNavTrailFields,
} from '../navTrailTracker.js';
import { StorageKeys } from '../../../utils/storage/types.js';

const ACTIVE = { enabled: true, consentedAt: 1_700_000_000_000 };
const INACTIVE = { enabled: false, consentedAt: null };

/** Default to a live consent; a test that needs it off says so explicitly. */
function consent(over: { enabled?: boolean; consentedAt?: number | null } = {}) {
  mockGetNavTrailConsent.mockResolvedValue({ ...ACTIVE, ...over });
}

describe('navTrailTracker', () => {
  beforeEach(() => {
    for (const key of Object.keys(sessionStore)) delete sessionStore[key];
    for (const key of Object.keys(localStore)) delete localStore[key];
    mockGetNavTrailConsent.mockReset();
    mockIsDomainAllowed.mockReset().mockResolvedValue(true);
    mockSanitizeRegex.mockReset().mockImplementation(async (t: string) => ({ text: t, maskedItems: [] }));
    mockSessionGet.mockReset();
    mockSessionSet.mockReset();
    mockSessionRemove.mockReset();
    mockLocalGet.mockReset();
    mockLocalSet.mockReset();
    mockStorageOnChanged.mockReset();
    consent();
  });

  it('records nothing while the feature is off', async () => {
    consent({ enabled: false });
    await onTabUrlChanged(1, 'https://a.dev/one');

    expect(mockSessionSet).not.toHaveBeenCalled();
    expect(await getNavSource(1, 'https://a.dev/one')).toBeNull();
  });

  it('does not persist a state when enabled but never consented', async () => {
    consent({ enabled: true, consentedAt: null });
    await onTabUrlChanged(1, 'https://a.dev/one');

    expect(mockSessionSet).not.toHaveBeenCalled();
  });

  it('treats a first visit as having no referrer', async () => {
    await onTabUrlChanged(1, 'https://a.dev/one');

    expect(await getNavSource(1, 'https://a.dev/one')).toBeNull();
  });

  it('returns the previous URL after a same-tab navigation', async () => {
    await onTabUrlChanged(1, 'https://a.dev/one');
    await onTabUrlChanged(1, 'https://b.dev/two');

    expect(await getNavSource(1, 'https://b.dev/two')).toBe('https://a.dev/one');
    // The old page is no longer current, so it has no referrer of its own.
    expect(await getNavSource(1, 'https://a.dev/one')).toBeNull();
  });

  it('keeps tabs independent', async () => {
    await onTabUrlChanged(1, 'https://a.dev/one');
    await onTabUrlChanged(2, 'https://c.dev/other');

    expect(await getNavSource(2, 'https://c.dev/other')).toBeNull();
  });

  it('ignores a reload and a fragment-only change', async () => {
    await onTabUrlChanged(1, 'https://a.dev/one');
    await onTabUrlChanged(1, 'https://a.dev/one');
    await onTabUrlChanged(1, 'https://a.dev/one#section');
    await onTabUrlChanged(1, 'https://b.dev/two');

    // The fragment change did not become the referrer.
    expect(await getNavSource(1, 'https://b.dev/two')).toBe('https://a.dev/one');
  });

  it('ignores a non-http(s) navigation', async () => {
    await onTabUrlChanged(1, 'about:blank');

    expect(mockSessionSet).not.toHaveBeenCalled();
  });

  it('forgets a removed tab', async () => {
    await onTabUrlChanged(1, 'https://a.dev/one');
    await onTabUrlChanged(1, 'https://b.dev/two');
    await onTabRemoved(1);

    expect(await getNavSource(1, 'https://b.dev/two')).toBeNull();
  });

  it('does not write when removing an unknown tab', async () => {
    await onTabRemoved(999);

    expect(mockSessionRemove).not.toHaveBeenCalled();
    expect(mockSessionSet).not.toHaveBeenCalled();
  });

  it('resolves the full source URL for an allowed domain', async () => {
    mockIsDomainAllowed.mockResolvedValue(true);
    await onTabUrlChanged(1, 'https://a.dev/one');
    await onTabUrlChanged(1, 'https://b.dev/two');

    const fields = await resolveNavTrailFields(1, 'https://b.dev/two');

    expect(fields).toEqual({ navSourceUrl: 'https://a.dev/one' });
  });

  it('collapses an excluded domain to its origin', async () => {
    mockIsDomainAllowed.mockResolvedValue(false);
    await onTabUrlChanged(1, 'https://www.google.com/search?q=secret');
    await onTabUrlChanged(1, 'https://b.dev/two');

    const fields = await resolveNavTrailFields(1, 'https://b.dev/two');

    expect(fields.navSourceUrl).toBe('https://www.google.com');
  });

  it('extracts and masks the search query from the referrer', async () => {
    mockSanitizeRegex.mockResolvedValue({ text: 'wasm sqlite', maskedItems: [] });
    await onTabUrlChanged(1, 'https://www.google.com/search?q=wasm%20sqlite');
    await onTabUrlChanged(1, 'https://b.dev/two');

    const fields = await resolveNavTrailFields(1, 'https://b.dev/two');

    expect(fields.searchQuery).toBe('wasm sqlite');
    expect(mockSanitizeRegex).toHaveBeenCalledWith('wasm sqlite');
  });

  it('omits searchQuery when the mask empties the term', async () => {
    mockSanitizeRegex.mockResolvedValue({ text: '', maskedItems: [] });
    await onTabUrlChanged(1, 'https://www.google.com/search?q=secret');
    await onTabUrlChanged(1, 'https://b.dev/two');

    const fields = await resolveNavTrailFields(1, 'https://b.dev/two');

    // The referrer itself is kept (this domain is allowed); only the term drops.
    expect(fields.navSourceUrl).toBe('https://www.google.com/search?q=secret');
    expect('searchQuery' in fields).toBe(false);
  });

  it('resolves to an empty object when the feature is off', async () => {
    await onTabUrlChanged(1, 'https://a.dev/one');
    await onTabUrlChanged(1, 'https://b.dev/two');
    consent({ enabled: false });

    expect(await resolveNavTrailFields(1, 'https://b.dev/two')).toEqual({});
  });

  it('clears every tracked tab', async () => {
    await onTabUrlChanged(1, 'https://a.dev/one');
    await clearAllNavTrail();

    expect(NAV_TRAIL_SESSION_KEY in sessionStore).toBe(false);
  });

  describe('consent watcher', () => {
    it('clears the map when consent is revoked', async () => {
      await onTabUrlChanged(1, 'https://a.dev/one');
      registerNavTrailConsentWatcher();
      const listener = mockStorageOnChanged.mock.calls[0]![0] as (
        changes: Record<string, { newValue?: unknown }>,
        area: string,
      ) => void;

      listener(
        { [StorageKeys.NAV_TRAIL_CONSENT]: { newValue: { enabled: false, consentedAt: null } } },
        'local',
      );
      await new Promise((r) => setTimeout(r, 0));

      expect(NAV_TRAIL_SESSION_KEY in sessionStore).toBe(false);
    });

    it('keeps the map when consent is granted', async () => {
      await onTabUrlChanged(1, 'https://a.dev/one');
      registerNavTrailConsentWatcher();
      const listener = mockStorageOnChanged.mock.calls[0]![0] as (
        changes: Record<string, { newValue?: unknown }>,
        area: string,
      ) => void;

      listener({ [StorageKeys.NAV_TRAIL_CONSENT]: { newValue: ACTIVE } }, 'local');
      await new Promise((r) => setTimeout(r, 0));

      expect(NAV_TRAIL_SESSION_KEY in sessionStore).toBe(true);
    });

    it('ignores a change in another storage area', async () => {
      await onTabUrlChanged(1, 'https://a.dev/one');
      registerNavTrailConsentWatcher();
      const listener = mockStorageOnChanged.mock.calls[0]![0] as (
        changes: Record<string, { newValue?: unknown }>,
        area: string,
      ) => void;

      listener({ [StorageKeys.NAV_TRAIL_CONSENT]: { newValue: INACTIVE } }, 'session');
      await new Promise((r) => setTimeout(r, 0));

      expect(NAV_TRAIL_SESSION_KEY in sessionStore).toBe(true);
    });
  });
});
