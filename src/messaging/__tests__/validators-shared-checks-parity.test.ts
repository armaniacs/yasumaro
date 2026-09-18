import { describe, it, expect } from 'vitest';
import {
  ValidVisitValidator,
  FetchUrlValidator,
  ManualRecordValidator,
  ValidationError,
  VALIDATOR_LIMITS,
} from '../validators.js';

function errorOf(fn: () => unknown): ValidationError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationError);
    return e as ValidationError;
  }
  throw new Error('expected ValidationError');
}

describe('validators shared checks parity (PBI 05)', () => {
  const validVisit = new ValidVisitValidator();
  const fetchUrl = new FetchUrlValidator();
  const manualRecord = new ManualRecordValidator();

  it('rejects non-numeric protocolVersion with identical message and field', () => {
    const a = errorOf(() =>
      validVisit.validate({ type: 'VALID_VISIT', payload: { content: 'x' }, protocolVersion: '1' }),
    );
    const b = errorOf(() =>
      fetchUrl.validate({ type: 'FETCH_URL', payload: { url: 'https://example.com' }, protocolVersion: '1' }),
    );
    for (const e of [a, b]) {
      expect(e.message).toBe('protocolVersion must be a number');
      expect(e.field).toBe('protocolVersion');
    }
    expect(a.validatorName).toBe('ValidVisitValidator');
    expect(b.validatorName).toBe('FetchUrlValidator');
  });

  it('rejects non-http(s) URLs with identical messages', () => {
    const cases: Array<[string, () => unknown]> = [
      ['empty', () => fetchUrl.validate({ type: 'FETCH_URL', payload: { url: '' } })],
      ['scheme', () => fetchUrl.validate({ type: 'FETCH_URL', payload: { url: 'javascript:alert(1)' } })],
      ['invalid', () => fetchUrl.validate({ type: 'FETCH_URL', payload: { url: '::not a url::' } })],
    ];
    const manualCases: Array<[string, () => unknown]> = [
      ['empty', () =>
        manualRecord.validate({ type: 'MANUAL_RECORD', payload: { title: 't', url: '', content: 'c' } })],
      ['scheme', () =>
        manualRecord.validate({
          type: 'MANUAL_RECORD',
          payload: { title: 't', url: 'data:text/plain,hi', content: 'c' },
        })],
      ['invalid', () =>
        manualRecord.validate({
          type: 'MANUAL_RECORD',
          payload: { title: 't', url: '::not a url::', content: 'c' },
        })],
    ];
    const expected: Record<string, string> = {
      empty: 'payload.url must be non-empty string',
      scheme: 'payload.url must be http or https',
      invalid: 'payload.url must be valid URL',
    };
    for (const [kind, fn] of cases) {
      const e = errorOf(fn);
      expect(e.message).toBe(expected[kind]);
      expect(e.field).toBe('url');
    }
    for (const [kind, fn] of manualCases) {
      const e = errorOf(fn);
      expect(e.message).toBe(expected[kind]);
      expect(e.field).toBe('url');
    }
  });

  it('rejects over-limit content with identical messages', () => {
    const over = 'x'.repeat(VALIDATOR_LIMITS.MAX_CONTENT_LENGTH + 1);
    const a = errorOf(() => validVisit.validate({ type: 'VALID_VISIT', payload: { content: over } }));
    const b = errorOf(() =>
      manualRecord.validate({ type: 'MANUAL_RECORD', payload: { title: 't', url: 'https://example.com', content: over } }),
    );
    for (const e of [a, b]) {
      expect(e.message).toBe(`payload.content exceeds ${VALIDATOR_LIMITS.MAX_CONTENT_LENGTH} chars`);
      expect(e.field).toBe('content');
    }
  });
});
