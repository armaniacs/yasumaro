/**
 * recordingGateTablePrivacy.test.ts — PBI 2026-10-24-04 pure-core pin.
 *
 * Pins the privacy helpers owned by the gate table so the step stays I/O-only:
 * behavior normalization, fetch-bypass predicate, and the deniedBy mapping.
 * Verdicts mirror checkPrivacyHeadersStep.test.ts; this file pins the pure
 * mechanics, not the step I/O.
 */

import {
  decideGate,
  describePrivacyDenial,
  normalizePrivacyAutoBehavior,
  shouldBypassPrivacyFetch,
} from '../recordingGateTable.js';
import * as gateTableModule from '../recordingGateTable.js';

describe('single interface (PBI 2026-10-24-04)', () => {
  it('exposes decideGate / evaluateGates and no parallel precedence scanner', () => {
    expect(typeof gateTableModule.decideGate).toBe('function');
    expect(typeof gateTableModule.evaluateGates).toBe('function');
    expect(
      (gateTableModule as Record<string, unknown>)['evaluateAdmissionPrecedence'],
      'evaluateAdmissionPrecedence must stay removed',
    ).toBeUndefined();
  });
});

describe('normalizePrivacyAutoBehavior', () => {
  it('keeps skip and confirm', () => {
    expect(normalizePrivacyAutoBehavior('skip')).toBe('skip');
    expect(normalizePrivacyAutoBehavior('confirm')).toBe('confirm');
  });

  it('falls back to save for save, empty, and unknown values', () => {
    expect(normalizePrivacyAutoBehavior('save')).toBe('save');
    expect(normalizePrivacyAutoBehavior('')).toBe('save');
    expect(normalizePrivacyAutoBehavior('weird')).toBe('save');
  });
});

describe('shouldBypassPrivacyFetch', () => {
  it('bypasses on force or whitelist only', () => {
    expect(shouldBypassPrivacyFetch(true, false)).toBe(true);
    expect(shouldBypassPrivacyFetch(false, true)).toBe(true);
    expect(shouldBypassPrivacyFetch(true, true)).toBe(true);
    expect(shouldBypassPrivacyFetch(false, false)).toBe(false);
  });
});

describe('describePrivacyDenial', () => {
  function denyWith(input: {
    autoSaveBehavior: 'save' | 'skip' | 'confirm';
    requireConfirmation: boolean;
  }) {
    const verdict = decideGate('privacyHeaders', {
      force: false,
      whitelisted: false,
      isPrivate: true,
      autoSaveBehavior: input.autoSaveBehavior,
      requireConfirmation: input.requireConfirmation,
    });
    expect(verdict.allow).toBe(false);
    return describePrivacyDenial(verdict);
  }

  it('maps skip to a reason-only denial', () => {
    expect(denyWith({ autoSaveBehavior: 'skip', requireConfirmation: false })).toEqual({
      confirmationRequired: false,
      includeHeaderValue: false,
    });
  });

  it('maps requireConfirmation to a confirmation denial without header value', () => {
    expect(denyWith({ autoSaveBehavior: 'save', requireConfirmation: true })).toEqual({
      confirmationRequired: true,
      includeHeaderValue: false,
    });
  });

  it('maps behavior=confirm to a confirmation denial with header value', () => {
    expect(denyWith({ autoSaveBehavior: 'confirm', requireConfirmation: false })).toEqual({
      confirmationRequired: true,
      includeHeaderValue: true,
    });
  });
});
