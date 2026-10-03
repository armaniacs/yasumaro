/**
 * recordingAdmission.test.ts — PBI 2026-10-01-03.
 *
 * Admission contract tests with fake consent / fake limiter (manual clock):
 * the unified `admit(kind, sender) → { settings } | { rejected }` seam, the
 * kind → bucket derivation, the sender narrowing, and the valid-visit flood
 * guard (ported from the former handler-level flood tests).
 */
import { useTimerClock } from '../../../testDir/waitPolicy.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RecordingAdmission,
  isRateLimitedVisit,
  resetVisitRateLimiter,
  type RecordingAdmissionDeps,
} from '../recordingAdmission.js';

const EXTENSION_SENDER = {
  id: 'test-extension-id',
  url: 'chrome-extension://test-extension-id/popup.html',
  tab: { id: 3 },
} as unknown as chrome.runtime.MessageSender;

function makeDeps(overrides: Partial<RecordingAdmissionDeps> = {}): RecordingAdmissionDeps {
  return {
    isRecordingAllowed: vi.fn().mockResolvedValue(true),
    getSettings: vi.fn().mockResolvedValue({}),
    rateLimiter: { check: vi.fn().mockResolvedValue({ allowed: true }) },
    ...overrides,
  };
}

function makeAdmission(overrides: Partial<RecordingAdmissionDeps> = {}) {
  const deps = makeDeps(overrides);
  return { deps, admission: new RecordingAdmission(deps) };
}

describe('RecordingAdmission — admitted path returns settings', () => {
  it.each(['manual', 'save', 'regenerate'] as const)('%s: admitted carries the settings read', async (kind) => {
    const { deps, admission } = makeAdmission({
      getSettings: vi.fn().mockResolvedValue({ auto: 'on' }),
    });

    const outcome = await admission.admit(kind, EXTENSION_SENDER);

    expect(outcome).toEqual({ settings: { auto: 'on' } });
    expect(deps.isRecordingAllowed).toHaveBeenCalledTimes(1);
  });

  it('save: does not counter-limit (explicit user action)', async () => {
    const { deps, admission } = makeAdmission();

    await admission.admit('save', EXTENSION_SENDER);

    expect(deps.rateLimiter.check).not.toHaveBeenCalled();
  });

  it('manual: runs the counter in the legacy default bucket (no bucket opt)', async () => {
    const { deps, admission } = makeAdmission({
      getSettings: vi.fn().mockResolvedValue({}),
    });

    await admission.admit('manual', EXTENSION_SENDER);

    expect(deps.rateLimiter.check).toHaveBeenCalledTimes(1);
    expect(deps.rateLimiter.check).toHaveBeenCalledWith(expect.anything(), {}, undefined);
  });

  it('regenerate: runs the counter in the separated regenerate bucket (CRITICAL: bucket)', async () => {
    const { deps, admission } = makeAdmission();

    await admission.admit('regenerate', EXTENSION_SENDER);

    expect(deps.rateLimiter.check).toHaveBeenCalledWith(
      expect.anything(),
      {},
      { bucket: 'regenerate' },
    );
  });

  it('narrows the sender to url + tab.id for the counter', async () => {
    const { deps, admission } = makeAdmission();

    await admission.admit('manual', EXTENSION_SENDER);

    const [senderLike] = deps.rateLimiter.check.mock.calls[0] as [unknown];
    expect(senderLike).toEqual({ url: 'chrome-extension://test-extension-id/popup.html', tab: { id: 3 } });
  });
});

describe('RecordingAdmission — consent rejection is one shape for every kind', () => {
  it.each(['valid-visit', 'manual', 'save', 'regenerate'] as const)('%s: rejected carries reason only', async (kind) => {
    const { deps, admission } = makeAdmission({
      isRecordingAllowed: vi.fn().mockResolvedValue(false),
    });

    const outcome = await admission.admit(kind, EXTENSION_SENDER);

    expect(outcome).toEqual({
      rejected: { success: false, reason: 'privacy_consent_required' },
    });
    // The settings read and the counter never run on a consent rejection.
    expect(deps.getSettings).not.toHaveBeenCalled();
    expect(deps.rateLimiter.check).not.toHaveBeenCalled();
  });
});

describe('RecordingAdmission — rate rejection is one shape', () => {
  it.each(['manual', 'regenerate'] as const)('%s: rejected carries reason + the limiter error', async (kind) => {
    const { admission } = makeAdmission({
      rateLimiter: { check: vi.fn().mockResolvedValue({ allowed: false, error: 'Rate limit exceeded. Please try again later.' }) },
    });

    const outcome = await admission.admit(kind, EXTENSION_SENDER);

    expect(outcome).toEqual({
      rejected: {
        success: false,
        reason: 'rate_limited',
        error: 'Rate limit exceeded. Please try again later.',
      },
    });
  });

  it('falls back to the rate_limited sentinel when the limiter reports no error', async () => {
    const { admission } = makeAdmission({
      rateLimiter: { check: vi.fn().mockResolvedValue({ allowed: false }) },
    });

    const outcome = await admission.admit('manual', EXTENSION_SENDER);

    expect(outcome).toEqual({
      rejected: { success: false, reason: 'rate_limited', error: 'rate_limited' },
    });
  });
});

describe('RecordingAdmission — valid-visit order (flood guard before consent)', () => {
  beforeEach(() => {
    resetVisitRateLimiter();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips the flood guard when sender.tab has no url', async () => {
    const { deps, admission } = makeAdmission();
    const sender = { tab: { id: 1 } } as unknown as chrome.runtime.MessageSender;

    const outcome = await admission.admit('valid-visit', sender);

    expect(outcome).toHaveProperty('settings');
    expect(deps.isRecordingAllowed).toHaveBeenCalledTimes(1);
  });

  it('rejects a repeat visit within the flood window before the consent read', async () => {
    useTimerClock();
    vi.setSystemTime(1_000_000);
    const { deps, admission } = makeAdmission();
    const sender = { tab: { id: 1, url: 'https://rate-limit.example.com' } } as unknown as chrome.runtime.MessageSender;

    await admission.admit('valid-visit', sender);
    const outcome = await admission.admit('valid-visit', sender);

    expect(outcome).toEqual({ rejected: { success: false, reason: 'rate_limited' } });
    // The flood guard runs before the consent read: only the FIRST admission
    // reached consent; the flood-limited repeat never got there.
    expect(deps.isRecordingAllowed).toHaveBeenCalledTimes(1);
    expect(deps.rateLimiter.check).not.toHaveBeenCalled();
  });

  it('allows a new visit after the flood window has elapsed', async () => {
    useTimerClock();
    vi.setSystemTime(1_000_000);
    const { admission } = makeAdmission();
    const sender = { tab: { id: 1, url: 'https://rate-window.example.com' } } as unknown as chrome.runtime.MessageSender;

    await admission.admit('valid-visit', sender);
    vi.advanceTimersByTime(5001);

    const outcome = await admission.admit('valid-visit', sender);

    expect(outcome).toHaveProperty('settings');
  });

  it('VULN-002: throttles same-origin visits across path/fragment rotation', async () => {
    useTimerClock();
    vi.setSystemTime(1_000_000);
    const { admission } = makeAdmission();

    await admission.admit('valid-visit', { tab: { id: 1, url: 'https://rotate.example.com/start' } } as unknown as chrome.runtime.MessageSender);
    const outcome = await admission.admit(
      'valid-visit',
      { tab: { id: 1, url: 'https://rotate.example.com/other#frag?x=1' } } as unknown as chrome.runtime.MessageSender,
    );

    expect(outcome).toEqual({ rejected: { success: false, reason: 'rate_limited' } });
  });

  it('does not rate limit different registrable domains against each other', async () => {
    const { admission } = makeAdmission();

    await admission.admit('valid-visit', { tab: { id: 1, url: 'https://a.example-a.com' } } as unknown as chrome.runtime.MessageSender);
    const outcome = await admission.admit('valid-visit', { tab: { id: 2, url: 'https://b.example-b.com' } } as unknown as chrome.runtime.MessageSender);

    expect(outcome).toHaveProperty('settings');
  });
});

// Ported from the former handler-level flood-guard tests: the per-URL
// visitRateLimiter is the admission module's internal adapter now.
describe('isRateLimitedVisit (visitRateLimiter adapter)', () => {
  beforeEach(() => {
    resetVisitRateLimiter();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sweeps expired entries on every call even when size is below MAX_ENTRIES', () => {
    useTimerClock();
    vi.setSystemTime(1_000_000);

    for (let i = 0; i < 997; i++) {
      isRateLimitedVisit(`https://site.example-${i}.com/page`);
    }

    vi.advanceTimersByTime(30_001);
    isRateLimitedVisit('https://fresh.example-fresh.com/page');
    isRateLimitedVisit('https://probe.example-probe.com/page');

    expect(isRateLimitedVisit('https://site.example-0.com/page')).toBe(false);
    expect(isRateLimitedVisit('https://fresh.example-fresh.com/page')).toBe(true);
  });

  it('still enforces the 5-second rate-limit window', () => {
    useTimerClock();
    vi.setSystemTime(1_000_000);

    isRateLimitedVisit('https://same-origin.example.com/page');
    expect(isRateLimitedVisit('https://same-origin.example.com/page')).toBe(true);

    vi.advanceTimersByTime(5001);
    expect(isRateLimitedVisit('https://same-origin.example.com/page')).toBe(false);
  });

  it('evicts the oldest entry when size still exceeds MAX_ENTRIES after TTL sweep', () => {
    useTimerClock();
    vi.setSystemTime(1_000_000);

    for (let i = 0; i < 1001; i++) {
      isRateLimitedVisit(`https://site.example-${i}.com/page`);
    }

    expect(isRateLimitedVisit('https://site.example-0.com/page')).toBe(false);
  });

  it('does not trigger the oldest-entry safeguard when TTL sweep already shrinks the map', () => {
    useTimerClock();
    vi.setSystemTime(1_000_000);

    for (let i = 0; i < 1050; i++) {
      isRateLimitedVisit(`https://site.example-${i}.com/page`);
    }
    vi.advanceTimersByTime(30_001);
    for (let i = 1050; i < 1090; i++) {
      isRateLimitedVisit(`https://site.example-${i}.com/page`);
    }

    expect(isRateLimitedVisit('https://final.example-final.com/page')).toBe(false);
    expect(isRateLimitedVisit('https://site.example-1050.com/page')).toBe(true);
  });

  it('sweeps 1000 entries in less than 50ms (median of 3 runs)', () => {
    vi.useRealTimers();

    for (let i = 0; i < 1000; i++) {
      isRateLimitedVisit(`https://perf.example-${i}.com/page`);
    }

    const times: number[] = [];
    for (let run = 0; run < 3; run++) {
      const start = performance.now();
      isRateLimitedVisit('https://bench.example-bench.com/page');
      const end = performance.now();
      times.push(end - start);
    }

    times.sort();
    expect(times[1]).toBeLessThan(50);
  });
});
