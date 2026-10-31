/**
 * selectionOriginWire.test.ts (PBI 2026-10-31-03)
 * Pins the contentOrigin wire path: the marker travels payload → validator →
 * RecordingData (via pickRecordDiagnostics/buildRecordRequest) so the saved
 * row can be identified as selection-derived.
 *
 * Fail-closed policy: the validator rejects any contentOrigin outside the
 * allowlist (utils/selectionText SELECTION_CONTENT_ORIGIN), so a hostile or
 * buggy sender cannot stamp an arbitrary origin string into the saved row.
 */
import { describe, it, expect } from 'vitest';
import { manualRecordValidator, ValidationError } from '../validators.js';
import { buildRecordPayload } from '../recordPayload.js';
import { SELECTION_CONTENT_ORIGIN } from '../../utils/selectionText.js';

const BASE_PAYLOAD = { title: 't', url: 'https://example.com', content: 'c' };

describe('manualRecordValidator - contentOrigin', () => {
  it('accepts contentOrigin: selection', () => {
    expect(() =>
      manualRecordValidator.validate({
        type: 'MANUAL_RECORD',
        payload: { ...BASE_PAYLOAD, contentOrigin: SELECTION_CONTENT_ORIGIN },
        protocolVersion: 1,
      }),
    ).not.toThrow();
  });

  it('accepts an absent contentOrigin (normal page record)', () => {
    expect(() =>
      manualRecordValidator.validate({ type: 'MANUAL_RECORD', payload: BASE_PAYLOAD, protocolVersion: 1 }),
    ).not.toThrow();
  });

  it('rejects a contentOrigin outside the allowlist', () => {
    for (const type of ['MANUAL_RECORD', 'PREVIEW_RECORD', 'SAVE_RECORD'] as const) {
      expect(() =>
        manualRecordValidator.validate({
          type,
          payload: { ...BASE_PAYLOAD, contentOrigin: 'page' },
          protocolVersion: 1,
        }),
      ).toThrow(ValidationError);
    }
  });

  it('rejects a non-string contentOrigin', () => {
    expect(() =>
      manualRecordValidator.validate({
        type: 'MANUAL_RECORD',
        payload: { ...BASE_PAYLOAD, contentOrigin: true },
        protocolVersion: 1,
      }),
    ).toThrow(ValidationError);
  });
});

describe('buildRecordPayload - contentOrigin', () => {
  it('carries contentOrigin on the MANUAL_RECORD envelope', () => {
    const payload = buildRecordPayload(
      'MANUAL_RECORD',
      { title: 'T', url: 'https://example.com' },
      'selected text',
      false,
      { contentOrigin: SELECTION_CONTENT_ORIGIN },
    );
    expect(payload).toMatchObject({ contentOrigin: 'selection', content: 'selected text' });
  });

  it('carries contentOrigin on the PREVIEW_RECORD envelope', () => {
    const payload = buildRecordPayload(
      'PREVIEW_RECORD',
      { title: 'T', url: 'https://example.com' },
      'selected text',
      false,
      { contentOrigin: SELECTION_CONTENT_ORIGIN },
    );
    expect(payload).toMatchObject({ contentOrigin: 'selection' });
  });

  it('carries contentOrigin on the SAVE_RECORD envelope next to maskedCount', () => {
    const payload = buildRecordPayload(
      'SAVE_RECORD',
      { title: 'T', url: 'https://example.com' },
      'masked text',
      false,
      { contentOrigin: SELECTION_CONTENT_ORIGIN, maskedCount: 2 },
    );
    expect(payload).toMatchObject({ contentOrigin: 'selection', maskedCount: 2 });
  });

  it('omits contentOrigin when the caller did not provide it (backward compatible)', () => {
    const payload = buildRecordPayload(
      'MANUAL_RECORD',
      { title: 'T', url: 'https://example.com' },
      'page text',
      false,
    );
    expect('contentOrigin' in payload).toBe(false);
  });
});
