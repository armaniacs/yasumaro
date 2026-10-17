/**
 * recordingDecision.test.ts — background-tier verdicts (PBI 2026-10-16-07)
 *
 * BDD: background-tier 判定関数に境界値・空・未定義を渡し、期待通りの真偽が返る。
 * Admission gate の真理表は src/utils/__tests__/recordingGateTable.test.ts が
 * 所有する（shim 重複の撤去）。ここでは trigger / header-detector /
 * save-skip / L0 のみを pin する。
 * Pure module のため chrome.* の mock は不要。
 */

import {
  decideRecordingTrigger,
  shouldProcessHeadersResponse,
  decideSaveSkip,
  decideL0,
} from '../recordingDecision.js';
import * as recordingDecisionModule from '../recordingDecision.js';

describe('shim removal (PBI 2026-10-16-07)', () => {
  it('exposes no admission-gate table symbols (single owner: recordingGateTable)', () => {
    for (const banned of [
      'RECORDING_DECISION_ORDER',
      'RECORDING_GATE_TABLE',
      'decideDomainFilter',
      'decidePermission',
      'decideTrust',
      'decidePrivacy',
      'decideDuplicate',
      'evaluateAdmissionPrecedence',
      'decideGate',
      'evaluateGates',
    ]) {
      expect(
        (recordingDecisionModule as Record<string, unknown>)[banned],
        `${banned} must not be re-exported`,
      ).toBeUndefined();
    }
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
