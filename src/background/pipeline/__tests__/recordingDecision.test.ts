/**
 * recordingDecision.test.ts — PBI 2026-09-19-08 各判定の純粋関数テスト
 *
 * BDD: 各判定関数に境界値・空・未定義を渡し、期待通りの真偽が返る。
 * Pure module のため chrome.* の mock は不要。
 */

import {
  RECORDING_DECISION_ORDER,
  decideDomainFilter,
  decidePermission,
  decideTrust,
  decidePrivacy,
  decideDuplicate,
  isSameUtcDay,
  decideRecordingTrigger,
  shouldProcessHeadersResponse,
  evaluateAdmissionPrecedence,
  decideSaveSkip,
  decideL0,
} from '../recordingDecision.js';

describe('RECORDING_DECISION_ORDER', () => {
  it('pins the precedence: domainFilter -> permission -> trust -> privacyHeaders -> duplicate', () => {
    expect([...RECORDING_DECISION_ORDER]).toEqual([
      'domainFilter',
      'permission',
      'trust',
      'privacyHeaders',
      'duplicate',
    ]);
  });
});

describe('decideDomainFilter', () => {
  it('allows when allowed', () => {
    expect(decideDomainFilter(true, false)).toEqual({ allow: true });
    expect(decideDomainFilter(true, true)).toEqual({ allow: true });
  });
  it('blocks with DOMAIN_BLOCKED when denied without force', () => {
    expect(decideDomainFilter(false, false)).toEqual({ allow: false, error: 'DOMAIN_BLOCKED' });
  });
  it('allows denied domain under force', () => {
    expect(decideDomainFilter(false, true)).toEqual({ allow: true });
  });
});

describe('decidePermission', () => {
  it('allows when permitted', () => {
    expect(decidePermission(true, 'example.com')).toEqual({ allow: true });
  });
  it('blocks with PERMISSION_REQUIRED when denied with resolvable domain', () => {
    expect(decidePermission(false, 'example.com')).toEqual({ allow: false, error: 'PERMISSION_REQUIRED' });
  });
  it('blocks with INVALID_URL when denied and domain is null', () => {
    expect(decidePermission(false, null)).toEqual({ allow: false, error: 'INVALID_URL' });
  });
  it('blocks with INVALID_URL when denied and domain is empty', () => {
    expect(decidePermission(false, '')).toEqual({ allow: false, error: 'INVALID_URL' });
  });
});

describe('decideTrust', () => {
  it('allows when canProceed', () => {
    expect(decideTrust(true, false)).toEqual({ allow: true });
  });
  it('blocks with DOMAIN_NOT_TRUSTED when untrusted without force', () => {
    expect(decideTrust(false, false)).toEqual({ allow: false, error: 'DOMAIN_NOT_TRUSTED' });
  });
  it('allows untrusted domain under force', () => {
    expect(decideTrust(false, true)).toEqual({ allow: true });
  });
});

describe('decidePrivacy', () => {
  const base = {
    force: false,
    whitelisted: false,
    isPrivate: true,
    autoSaveBehavior: 'skip' as const,
    requireConfirmation: false,
  };
  it('allows under force even when private', () => {
    expect(decidePrivacy({ ...base, force: true })).toMatchObject({ allow: true, savePending: false });
  });
  it('allows whitelisted domains even when private', () => {
    expect(decidePrivacy({ ...base, whitelisted: true })).toMatchObject({ allow: true, savePending: false });
  });
  it('allows non-private pages', () => {
    expect(decidePrivacy({ ...base, isPrivate: false })).toMatchObject({ allow: true, savePending: false });
  });
  it('blocks with pending-save when requireConfirmation', () => {
    expect(
      decidePrivacy({ ...base, autoSaveBehavior: 'save', requireConfirmation: true })
    ).toEqual({
      allow: false,
      error: 'PRIVATE_PAGE_DETECTED',
      savePending: true,
      confirmationRequired: true,
      deniedBy: 'requireConfirmation',
    });
  });
  it('blocks with pending-save when behavior=skip', () => {
    expect(decidePrivacy({ ...base, autoSaveBehavior: 'skip' })).toMatchObject({
      allow: false,
      error: 'PRIVATE_PAGE_DETECTED',
      savePending: true,
    });
  });
  it('blocks with confirmation when behavior=confirm', () => {
    expect(decidePrivacy({ ...base, autoSaveBehavior: 'confirm' })).toEqual({
      allow: false,
      error: 'PRIVATE_PAGE_DETECTED',
      savePending: true,
      confirmationRequired: true,
      deniedBy: 'confirm',
    });
  });
  it('allows private pages when behavior=save', () => {
    expect(decidePrivacy({ ...base, autoSaveBehavior: 'save' })).toMatchObject({
      allow: true,
      savePending: false,
    });
  });
});

describe('decideDuplicate', () => {
  const noon = Date.UTC(2026, 8, 19, 12, 0, 0);
  const morning = Date.UTC(2026, 8, 19, 1, 0, 0);
  const yesterday = Date.UTC(2026, 8, 18, 23, 0, 0);
  it('blocks same-UTC-day duplicates', () => {
    expect(
      decideDuplicate({ skipCheck: false, savedTimestamp: morning, now: noon, urlMapSize: 1, maxSize: 100 })
    ).toEqual({ allow: false, error: 'same_day' });
  });
  it('allows different-day re-recording', () => {
    expect(
      decideDuplicate({ skipCheck: false, savedTimestamp: yesterday, now: noon, urlMapSize: 1, maxSize: 100 })
    ).toEqual({ allow: true });
  });
  it('skips the same-day check when skipCheck=true', () => {
    expect(
      decideDuplicate({ skipCheck: true, savedTimestamp: morning, now: noon, urlMapSize: 1, maxSize: 100 })
    ).toEqual({ allow: true });
  });
  it('allows first-time URLs (undefined timestamp)', () => {
    expect(
      decideDuplicate({ skipCheck: false, savedTimestamp: undefined, now: noon, urlMapSize: 1, maxSize: 100 })
    ).toEqual({ allow: true });
  });
  it('blocks when the URL set is at the limit', () => {
    expect(
      decideDuplicate({ skipCheck: false, savedTimestamp: undefined, now: noon, urlMapSize: 100, maxSize: 100 })
    ).toEqual({ allow: false, error: 'URL_SET_LIMIT_EXCEEDED' });
  });
});

describe('isSameUtcDay', () => {
  it('matches across a JST date boundary within the same UTC day', () => {
    // 2026-09-19 08:59 JST == 2026-09-18 23:59 UTC vs 2026-09-19 00:01 UTC -> different UTC days
    expect(isSameUtcDay(Date.UTC(2026, 8, 18, 23, 59), Date.UTC(2026, 8, 19, 0, 1))).toBe(false);
    expect(isSameUtcDay(Date.UTC(2026, 8, 19, 0, 1), Date.UTC(2026, 8, 19, 23, 59))).toBe(true);
  });
});

describe('decideRecordingTrigger', () => {
  const triggers = { scrollAndTime: true, manualSave: true, periodicSnapshot: false };
  it('fires scroll_idle at exact thresholds (boundary inclusive)', () => {
    expect(
      decideRecordingTrigger({ type: 'scroll_idle', scrollPercent: 50, visitDuration: 5000 }, triggers, 50, 5000)
    ).toBe(true);
  });
  it('rejects scroll_idle below either threshold', () => {
    expect(
      decideRecordingTrigger({ type: 'scroll_idle', scrollPercent: 49, visitDuration: 5000 }, triggers, 50, 5000)
    ).toBe(false);
    expect(
      decideRecordingTrigger({ type: 'scroll_idle', scrollPercent: 50, visitDuration: 4999 }, triggers, 50, 5000)
    ).toBe(false);
  });
  it('treats undefined scroll/visit as 0 (reject)', () => {
    expect(decideRecordingTrigger({ type: 'scroll_idle' }, triggers, 50, 5000)).toBe(false);
  });
  it('rejects scroll_idle when the trigger is disabled', () => {
    expect(
      decideRecordingTrigger(
        { type: 'scroll_idle', scrollPercent: 100, visitDuration: 99999 },
        { ...triggers, scrollAndTime: false },
        50,
        5000
      )
    ).toBe(false);
  });
  it('delegates manual_save / snapshot to flags', () => {
    expect(decideRecordingTrigger({ type: 'manual_save' }, triggers, 50, 5000)).toBe(true);
    expect(decideRecordingTrigger({ type: 'manual_save' }, { ...triggers, manualSave: false }, 50, 5000)).toBe(false);
    expect(decideRecordingTrigger({ type: 'snapshot' }, triggers, 50, 5000)).toBe(false);
    expect(decideRecordingTrigger({ type: 'snapshot' }, { ...triggers, periodicSnapshot: true }, 50, 5000)).toBe(true);
  });
  it('rejects unknown event types', () => {
    expect(decideRecordingTrigger({ type: 'weird' }, triggers, 50, 5000)).toBe(false);
    expect(decideRecordingTrigger({ type: '' }, triggers, 50, 5000)).toBe(false);
  });
});

describe('shouldProcessHeadersResponse', () => {
  it('processes main_frame HTML', () => {
    expect(shouldProcessHeadersResponse('main_frame', 'text/html; charset=utf-8')).toEqual({ process: true });
  });
  it('skips non-main_frame', () => {
    expect(shouldProcessHeadersResponse('sub_frame', 'text/html')).toEqual({
      process: false,
      reason: 'non-main_frame',
    });
  });
  it('skips non-HTML', () => {
    expect(shouldProcessHeadersResponse('main_frame', 'image/png')).toEqual({
      process: false,
      reason: 'non-html',
    });
  });
  it('skips undefined type / content-type', () => {
    expect(shouldProcessHeadersResponse(undefined, 'text/html')).toMatchObject({ process: false });
    expect(shouldProcessHeadersResponse('main_frame', undefined)).toMatchObject({ process: false });
  });
});

describe('evaluateAdmissionPrecedence', () => {  const none = { domainFilter: false, permission: false, trust: false, privacyHeaders: false, duplicate: false };
  it('returns null when nothing fails', () => {
    expect(evaluateAdmissionPrecedence(none)).toBeNull();
  });
  it('returns the earliest failing gate when several fail', () => {
    expect(
      evaluateAdmissionPrecedence({ ...none, permission: true, trust: true, privacyHeaders: true })
    ).toBe('permission');
    expect(evaluateAdmissionPrecedence({ ...none, trust: true, privacyHeaders: true })).toBe('trust');
    expect(evaluateAdmissionPrecedence({ ...none, privacyHeaders: true, duplicate: true })).toBe(
      'privacyHeaders'
    );
  });
  it('domainFilter outranks everything', () => {
    expect(
      evaluateAdmissionPrecedence({
        domainFilter: true,
        permission: true,
        trust: true,
        privacyHeaders: true,
        duplicate: true,
      })
    ).toBe('domainFilter');
  });
});

describe('decideSaveSkip', () => {
  it('skips when obsidian is disabled even with a client present', () => {
    expect(decideSaveSkip(false, true)).toMatchObject({ skip: true });
  });
  it('skips when the client is absent even when obsidian is enabled', () => {
    expect(decideSaveSkip(true, false)).toMatchObject({ skip: true });
  });
  it('skips when both disabled and absent (disabled takes precedence)', () => {
    expect(decideSaveSkip(false, false)).toMatchObject({ skip: true });
  });
  it('proceeds when enabled with a client present', () => {
    expect(decideSaveSkip(true, true)).toEqual({ skip: false });
  });
});

describe('decideL0', () => {
  it('skips when L0 extraction is disabled', () => {
    expect(decideL0(false)).toMatchObject({ skip: true });
  });
  it('proceeds when L0 extraction is enabled', () => {
    expect(decideL0(true)).toEqual({ skip: false });
  });
});
