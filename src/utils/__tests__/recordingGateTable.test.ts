/**
 * recordingGateTable.test.ts — PBI 2026-09-23-05 neutral gate table seam.
 *
 * Pins the single precedence owner: table shape, decideGate dispatch,
 * evaluateGates FATAL short-circuit, and the shared scheme predicates.
 * The verdict semantics mirror recordingDecision.test.ts; this file pins the
 * table mechanics, not the verdict matrix itself.
 */

import {
  RECORDING_DECISION_ORDER,
  RECORDING_GATE_TABLE,
  decideGate,
  evaluateGates,
  isHttpRecordableUrl,
  isRecordableTab,
  type RecordingGateInputs,
} from '../recordingGateTable.js';

function allowAll(): RecordingGateInputs {
  return {
    domainFilter: { isAllowed: true, force: false },
    permission: { permitted: true, domain: 'example.com' },
    trust: { canProceed: true, force: false },
    privacyHeaders: {
      force: false,
      whitelisted: false,
      isPrivate: false,
      autoSaveBehavior: 'save',
      requireConfirmation: false,
    },
    duplicate: { skipCheck: false, savedTimestamp: undefined, now: 1, urlMapSize: 0, maxSize: 100 },
  };
}

function denyAll(): RecordingGateInputs {
  const noon = Date.UTC(2026, 8, 19, 12, 0, 0);
  const morning = Date.UTC(2026, 8, 19, 1, 0, 0);
  return {
    domainFilter: { isAllowed: false, force: false },
    permission: { permitted: false, domain: 'example.com' },
    trust: { canProceed: false, force: false },
    privacyHeaders: {
      force: false,
      whitelisted: false,
      isPrivate: true,
      autoSaveBehavior: 'skip',
      requireConfirmation: false,
    },
    duplicate: { skipCheck: false, savedTimestamp: morning, now: noon, urlMapSize: 1, maxSize: 100 },
  };
}

describe('RECORDING_GATE_TABLE shape', () => {
  it('holds one row per gate in precedence order', () => {
    expect(RECORDING_GATE_TABLE.map((row) => row.name)).toEqual([...RECORDING_DECISION_ORDER]);
    expect(RECORDING_GATE_TABLE.map((row) => row.name)).toEqual([
      'domainFilter',
      'permission',
      'trust',
      'privacyHeaders',
      'duplicate',
    ]);
  });

  it('exposes a decide function on every row', () => {
    for (const row of RECORDING_GATE_TABLE) {
      expect(typeof row.decide).toBe('function');
    }
  });
});

describe('decideGate dispatch', () => {
  it('routes each gate to its verdict with the same codes as the pure functions', () => {
    expect(decideGate('domainFilter', { isAllowed: false, force: false })).toEqual({
      allow: false,
      error: 'DOMAIN_BLOCKED',
    });
    expect(decideGate('permission', { permitted: false, domain: 'example.com' })).toEqual({
      allow: false,
      error: 'PERMISSION_REQUIRED',
    });
    expect(decideGate('trust', { canProceed: false, force: false })).toEqual({
      allow: false,
      error: 'DOMAIN_NOT_TRUSTED',
    });
    expect(
      decideGate('duplicate', { skipCheck: false, savedTimestamp: undefined, now: 1, urlMapSize: 5, maxSize: 5 })
    ).toEqual({ allow: false, error: 'URL_SET_LIMIT_EXCEEDED' });
  });

  it('preserves the privacy decision extras (savePending / deniedBy)', () => {
    const verdict = decideGate('privacyHeaders', {
      force: false,
      whitelisted: false,
      isPrivate: true,
      autoSaveBehavior: 'skip',
      requireConfirmation: false,
    });
    expect(verdict).toEqual({
      allow: false,
      error: 'PRIVATE_PAGE_DETECTED',
      savePending: true,
      deniedBy: 'skip',
    });
  });

  it('throws on an unknown gate name', () => {
    expect(() =>
      decideGate('quota' as unknown as 'domainFilter', { isAllowed: true, force: false })
    ).toThrow('Unknown recording gate: quota');
  });
});

describe('evaluateGates FATAL short-circuit', () => {
  it('returns null gate when every gate allows', () => {
    expect(evaluateGates(allowAll())).toEqual({ gate: null, verdict: { allow: true } });
  });

  it('returns the earliest denying gate when all deny', () => {
    expect(evaluateGates(denyAll())).toMatchObject({
      gate: 'domainFilter',
      verdict: { allow: false, error: 'DOMAIN_BLOCKED' },
    });
  });

  it('walks the precedence one gate at a time', () => {
    const cases: Array<{ fix: (inputs: RecordingGateInputs) => void; winner: string; error: string }> = [
      {
        fix: (inputs) => {
          inputs.domainFilter = { isAllowed: true, force: false };
        },
        winner: 'permission',
        error: 'PERMISSION_REQUIRED',
      },
      {
        fix: (inputs) => {
          inputs.domainFilter = { isAllowed: true, force: false };
          inputs.permission = { permitted: true, domain: 'example.com' };
        },
        winner: 'trust',
        error: 'DOMAIN_NOT_TRUSTED',
      },
      {
        fix: (inputs) => {
          inputs.domainFilter = { isAllowed: true, force: false };
          inputs.permission = { permitted: true, domain: 'example.com' };
          inputs.trust = { canProceed: true, force: false };
        },
        winner: 'privacyHeaders',
        error: 'PRIVATE_PAGE_DETECTED',
      },
      {
        fix: (inputs) => {
          inputs.domainFilter = { isAllowed: true, force: false };
          inputs.permission = { permitted: true, domain: 'example.com' };
          inputs.trust = { canProceed: true, force: false };
          inputs.privacyHeaders = { ...inputs.privacyHeaders, isPrivate: false };
        },
        winner: 'duplicate',
        error: 'same_day',
      },
    ];
    for (const { fix, winner, error } of cases) {
      const inputs = denyAll();
      fix(inputs);
      expect(evaluateGates(inputs)).toMatchObject({ gate: winner, verdict: { allow: false, error } });
    }
  });

  it('mirrors the force-bypass parity: permission still denies under force', () => {
    const inputs = denyAll();
    const forced = {
      domainFilter: { ...inputs.domainFilter, force: true },
      permission: inputs.permission,
      trust: { ...inputs.trust, force: true },
      privacyHeaders: { ...inputs.privacyHeaders, force: true },
      duplicate: inputs.duplicate,
    };
    expect(evaluateGates(forced)).toMatchObject({
      gate: 'permission',
      verdict: { allow: false, error: 'PERMISSION_REQUIRED' },
    });
  });
});

describe('shared scheme predicates', () => {
  it('allows http/https URLs (byte-identical to tabUtils.isRecordable)', () => {
    expect(isHttpRecordableUrl('http://example.com')).toBe(true);
    expect(isHttpRecordableUrl('https://example.com/page')).toBe(true);
  });

  it('rejects non-http schemes, empty, and missing URLs', () => {
    expect(isHttpRecordableUrl('chrome://extensions')).toBe(false);
    expect(isHttpRecordableUrl('chrome-extension://id/page')).toBe(false);
    expect(isHttpRecordableUrl('about:blank')).toBe(false);
    expect(isHttpRecordableUrl('')).toBe(false);
    expect(isHttpRecordableUrl(null)).toBe(false);
    expect(isHttpRecordableUrl(undefined)).toBe(false);
  });

  it('isRecordableTab reads the tab shape without the chrome.tabs.Tab type', () => {
    expect(isRecordableTab({ url: 'https://example.com' })).toBe(true);
    expect(isRecordableTab({ url: 'chrome://extensions' })).toBe(false);
    expect(isRecordableTab({})).toBe(false);
    expect(isRecordableTab(null)).toBe(false);
    expect(isRecordableTab(undefined)).toBe(false);
  });
});
