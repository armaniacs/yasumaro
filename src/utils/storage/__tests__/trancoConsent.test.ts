/**
 * trancoConsent unit tests.
 *
 * The 30-day retry rule is pinned here and only here: popup and dashboard both
 * delegate to this module, so their suites cover their own state mapping while
 * the boundary itself lives in this file. `now` is injected, so no test waits
 * on the wall clock or fakes timers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockSaveAndRefresh } = vi.hoisted(() => ({
  mockSaveAndRefresh: vi.fn(),
}));

vi.mock('../domainFilterCache.js', () => ({
  saveSettingsAndRefreshDomainFilterCache: mockSaveAndRefresh,
}));

import {
  TRANCO_CONSENT_RETRY_INTERVAL_DAYS,
  evaluateTrancoConsent,
  needsTrancoConsent,
  persistTrancoConsentDeny,
  persistTrancoConsentGrant,
} from '../trancoConsent.js';
import { StorageKeys } from '../types.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 0, 31, 12, 0, 0);

function daysAgo(days: number): number {
  return NOW - days * MS_PER_DAY;
}

describe('evaluateTrancoConsent', () => {
  it('keeps the retry interval at 30 days', () => {
    expect(TRANCO_CONSENT_RETRY_INTERVAL_DAYS).toBe(30);
  });

  it.each([
    { label: '29 days', deniedTimestamp: daysAgo(29), needsConsent: false, daysUntilRetry: 1 },
    { label: 'exactly 30 days', deniedTimestamp: daysAgo(30), needsConsent: true, daysUntilRetry: 0 },
    { label: '31 days', deniedTimestamp: daysAgo(31), needsConsent: true, daysUntilRetry: 0 },
  ])('judges the retry window at $label', ({ deniedTimestamp, needsConsent, daysUntilRetry }) => {
    const decision = evaluateTrancoConsent(
      { currentVersion: 'v2', grantedVersion: 'v1', deniedTimestamp },
      NOW,
    );

    expect(decision.needsConsent).toBe(needsConsent);
    expect(decision.daysUntilRetry).toBe(daysUntilRetry);
    expect(decision.hasDenial).toBe(true);
    expect(decision.alreadyGranted).toBe(false);
  });

  it('does not round a partial day up to a re-prompt', () => {
    // One millisecond short of the 30-day mark: the old dashboard arithmetic
    // (Math.ceil on elapsed days) reported the retry as due here.
    const decision = evaluateTrancoConsent(
      {
        currentVersion: 'v2',
        grantedVersion: 'v1',
        deniedTimestamp: NOW - 30 * MS_PER_DAY + 1,
      },
      NOW,
    );

    expect(decision.needsConsent).toBe(false);
    expect(decision.daysUntilRetry).toBe(1);
  });

  it('prompts immediately at the 30-day mark', () => {
    const decision = evaluateTrancoConsent(
      {
        currentVersion: 'v2',
        grantedVersion: 'v1',
        deniedTimestamp: NOW - 30 * MS_PER_DAY,
      },
      NOW,
    );

    expect(decision.needsConsent).toBe(true);
    expect(decision.daysUntilRetry).toBe(0);
  });

  it('reports the whole days left inside the retry window', () => {
    const decision = evaluateTrancoConsent(
      { currentVersion: 'v2', grantedVersion: 'v1', deniedTimestamp: daysAgo(20) },
      NOW,
    );

    expect(decision.needsConsent).toBe(false);
    expect(decision.daysUntilRetry).toBe(10);
  });

  it('asks for consent when the current version was never granted', () => {
    const decision = evaluateTrancoConsent(
      { currentVersion: 'v2', grantedVersion: null, deniedTimestamp: null },
      NOW,
    );

    expect(decision).toEqual({
      alreadyGranted: false,
      hasDenial: false,
      needsConsent: true,
      daysUntilRetry: null,
    });
  });

  it('stays quiet when consent matches the current version', () => {
    const decision = evaluateTrancoConsent(
      { currentVersion: 'v2', grantedVersion: 'v2', deniedTimestamp: null },
      NOW,
    );

    expect(decision).toEqual({
      alreadyGranted: true,
      hasDenial: false,
      needsConsent: false,
      daysUntilRetry: null,
    });
  });

  it.each([
    { label: 'a stale denial', deniedTimestamp: daysAgo(90) },
    { label: 'a non-finite timestamp', deniedTimestamp: Number.NaN },
  ])('never prompts on an already granted version with $label', ({ deniedTimestamp }) => {
    const decision = evaluateTrancoConsent(
      { currentVersion: 'v2', grantedVersion: 'v2', deniedTimestamp },
      NOW,
    );

    expect(decision.needsConsent).toBe(false);
    expect(decision.alreadyGranted).toBe(true);
  });

  it('treats a non-finite timestamp as no denial record', () => {
    const decision = evaluateTrancoConsent(
      { currentVersion: 'v2', grantedVersion: 'v1', deniedTimestamp: Number.NaN },
      NOW,
    );

    expect(decision).toEqual({
      alreadyGranted: false,
      hasDenial: false,
      needsConsent: true,
      daysUntilRetry: null,
    });
  });

  it('defaults now to the current time', () => {
    const snapshot = { currentVersion: 'v2', grantedVersion: 'v1', deniedTimestamp: Date.now() - 29 * MS_PER_DAY };

    expect(needsTrancoConsent(snapshot)).toBe(false);
    expect(needsTrancoConsent({ ...snapshot, deniedTimestamp: Date.now() - 31 * MS_PER_DAY })).toBe(true);
  });
});

describe('needsTrancoConsent', () => {
  it('is the boolean view of the same decision', () => {
    const snapshot = { currentVersion: 'v2', grantedVersion: 'v1', deniedTimestamp: daysAgo(10) };

    expect(needsTrancoConsent(snapshot, NOW)).toBe(evaluateTrancoConsent(snapshot, NOW).needsConsent);
  });

  it('agrees with the rule on both sides of the boundary', () => {
    const granted = 'v1';
    expect(needsTrancoConsent({ currentVersion: 'v2', grantedVersion: granted, deniedTimestamp: daysAgo(29) }, NOW)).toBe(false);
    expect(needsTrancoConsent({ currentVersion: 'v2', grantedVersion: granted, deniedTimestamp: daysAgo(31) }, NOW)).toBe(true);
  });
});

describe('consent persistence', () => {
  beforeEach(() => {
    mockSaveAndRefresh.mockReset();
    mockSaveAndRefresh.mockResolvedValue(undefined);
  });

  it('writes the granted version and clears the denial keys', async () => {
    await persistTrancoConsentGrant('2026-01-31');

    expect(mockSaveAndRefresh).toHaveBeenCalledTimes(1);
    expect(mockSaveAndRefresh).toHaveBeenCalledWith({
      [StorageKeys.TRANCO_CONSENT_GRANTED]: '2026-01-31',
      [StorageKeys.TRANCO_CONSENT_DENIED_REASON]: null,
      [StorageKeys.TRANCO_CONSENT_DENIED_TIMESTAMP]: null,
    });
  });

  it('writes the deny reason and timestamp and clears the granted version', async () => {
    await persistTrancoConsentDeny(NOW);

    expect(mockSaveAndRefresh).toHaveBeenCalledTimes(1);
    expect(mockSaveAndRefresh).toHaveBeenCalledWith({
      [StorageKeys.TRANCO_CONSENT_GRANTED]: null,
      [StorageKeys.TRANCO_CONSENT_DENIED_REASON]: 'deny',
      [StorageKeys.TRANCO_CONSENT_DENIED_TIMESTAMP]: NOW,
    });
  });

  it('stamps the denial with the current time by default', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);

    try {
      await persistTrancoConsentDeny();

      expect(mockSaveAndRefresh).toHaveBeenCalledWith(
        expect.objectContaining({ [StorageKeys.TRANCO_CONSENT_DENIED_TIMESTAMP]: NOW }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
