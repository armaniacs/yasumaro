/**
 * Nav trail supply pins for the VALID_VISIT handler (PBI 2026-10-07-18).
 *
 * The map is supplied from the handler — after admit, not dependent on
 * recordVisit's success — because the old changeInfo.url writer was a
 * structural no-op on normal sites (no "tabs" permission, minimized host
 * permissions; ADR 2026-10-07-tab-url-permission-decision). These tests pin
 * the semantics change: the referrer is the previous RECORDED url in the
 * same tab, not the previous navigation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAdmit = vi.fn();
const mockRecordVisit = vi.fn();

const sessionStore: Record<string, unknown> = {};

vi.stubGlobal('chrome', {
  action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
  storage: {
    session: {
      get: (key: string) =>
        Promise.resolve(key in sessionStore ? { [key]: sessionStore[key] } : {}),
      set: (obj: Record<string, unknown>) => {
        Object.assign(sessionStore, obj);
        return Promise.resolve();
      },
      remove: (key: string) => {
        delete sessionStore[key];
        return Promise.resolve();
      },
    },
  },
});

vi.mock('../../utils/storage/navTrailConsent.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/storage/navTrailConsent.js')>();
  return {
    ...actual,
    getNavTrailConsent: vi.fn().mockResolvedValue({ enabled: true, consentedAt: 1_700_000_000_000 }),
  };
});
vi.mock('../../utils/domainUtils.js', () => ({ isDomainAllowed: vi.fn().mockResolvedValue(true) }));
vi.mock('../../utils/piiSanitizer.js', () => ({
  sanitizeRegex: vi.fn(async (text: string) => ({ text })),
}));

import { createValidVisitHandler } from '../handlers/recordingHandlers.js';
import { NAV_TRAIL_SESSION_KEY } from '../navTrail/navTrailTracker.js';
import type { RecordingData } from '../../messaging/types.js';

function makeDeps() {
  return {
    admit: mockAdmit,
    cacheTab: vi.fn(),
    updateCachedTab: vi.fn(),
    recordVisit: mockRecordVisit,
    addBadgeTab: vi.fn(),
    hasBadgeTab: vi.fn().mockReturnValue(false),
  };
}

function sender(tab: { id: number; url: string; incognito?: boolean }): chrome.runtime.MessageSender {
  return { tab: { ...tab } } as chrome.runtime.MessageSender;
}

const sendResponse = vi.fn();

describe('VALID_VISIT nav trail supply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(sessionStore)) delete sessionStore[key];
    mockAdmit.mockResolvedValue({ ok: true } as never);
    mockRecordVisit.mockResolvedValue({ success: true, skipped: false });
  });

  it('a first recorded visit has no referrer', async () => {
    const handler = createValidVisitHandler(makeDeps());
    await handler({ type: 'VALID_VISIT', payload: { content: '' } } as never, sender({ id: 7, url: 'https://a.example.com/page' }), sendResponse);

    const data = mockRecordVisit.mock.calls[0]![0] as RecordingData;
    expect(data.navSourceUrl).toBeUndefined();
  });

  it('a second recorded visit in the same tab carries the previous recorded url as referrer', async () => {
    const handler = createValidVisitHandler(makeDeps());
    await handler({ type: 'VALID_VISIT', payload: { content: '' } } as never, sender({ id: 7, url: 'https://a.example.com/page' }), sendResponse);
    await handler({ type: 'VALID_VISIT', payload: { content: '' } } as never, sender({ id: 7, url: 'https://b.example.com/other' }), sendResponse);

    const data = mockRecordVisit.mock.calls[1]![0] as RecordingData;
    expect(data.navSourceUrl).toBe('https://a.example.com/page');
  });

  it('the map is updated even when recordVisit fails (not dependent on recording success)', async () => {
    mockRecordVisit.mockResolvedValueOnce({ success: false });
    const handler = createValidVisitHandler(makeDeps());
    await handler({ type: 'VALID_VISIT', payload: { content: '' } } as never, sender({ id: 7, url: 'https://a.example.com/page' }), sendResponse);

    const map = sessionStore[NAV_TRAIL_SESSION_KEY] as Record<string, { current?: string }>;
    expect(map['7']?.current).toBe('https://a.example.com/page');
  });

  it('a visit that is not admitted does not update the map (semantics pin)', async () => {
    mockAdmit.mockResolvedValue({ rejected: { success: false, error: 'RATE_LIMITED' } });
    const handler = createValidVisitHandler(makeDeps());
    await handler({ type: 'VALID_VISIT', payload: { content: '' } } as never, sender({ id: 7, url: 'https://a.example.com/page' }), sendResponse);

    expect(sessionStore[NAV_TRAIL_SESSION_KEY]).toBeUndefined();
  });

  it('an incognito tab does not supply the map (defence in depth)', async () => {
    const handler = createValidVisitHandler(makeDeps());
    await handler(
      { type: 'VALID_VISIT', payload: { content: '' } } as never,
      sender({ id: 7, url: 'https://a.example.com/page', incognito: true }),
      sendResponse,
    );

    expect(sessionStore[NAV_TRAIL_SESSION_KEY]).toBeUndefined();
  });

  it('a sender without a tab does not supply the map', async () => {
    const handler = createValidVisitHandler(makeDeps());
    await handler({ type: 'VALID_VISIT', payload: { content: '' } } as never, {} as chrome.runtime.MessageSender, sendResponse);

    expect(sessionStore[NAV_TRAIL_SESSION_KEY]).toBeUndefined();
  });
});
