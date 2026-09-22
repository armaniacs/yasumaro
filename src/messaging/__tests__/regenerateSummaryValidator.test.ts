import { describe, it, expect } from 'vitest';
import {
  RegenerateSummaryValidator,
  ValidationError,
  regenerateSummaryValidator,
} from '../validators.js';

const v = new RegenerateSummaryValidator();

function validMsg(overrides: Record<string, unknown> = {}) {
  return {
    type: 'REGENERATE_SUMMARY',
    payload: {
      id: 7,
      url: 'https://example.com/page',
      title: 'T',
      cleanseMode: 'current',
      ...overrides,
    },
    protocolVersion: 1,
  };
}

describe('RegenerateSummaryValidator', () => {
  it('singleton is an instance of the class', () => {
    expect(regenerateSummaryValidator).toBeInstanceOf(RegenerateSummaryValidator);
  });

  it('accepts each cleanseMode (CRITICAL: current/looser/loosest)', () => {
    for (const cleanseMode of ['current', 'looser', 'loosest']) {
      expect(() => v.validate(validMsg({ cleanseMode }))).not.toThrow();
    }
  });

  it('accepts optional boolean force and absent force (CRITICAL: force-default-off)', () => {
    expect(() => v.validate(validMsg({ force: true }))).not.toThrow();
    expect(() => v.validate(validMsg())).not.toThrow();
  });

  it('rejects non-positive / non-integer ids', () => {
    for (const id of [0, -1, 1.5, '7', NaN]) {
      expect(() => v.validate(validMsg({ id })), `id=${String(id)}`).toThrow(ValidationError);
    }
  });

  it('rejects non-http(s) and malformed urls', () => {
    expect(() => v.validate(validMsg({ url: 'javascript:alert(1)' }))).toThrow(ValidationError);
    expect(() => v.validate(validMsg({ url: 'not-a-url' }))).toThrow(ValidationError);
    expect(() => v.validate(validMsg({ url: '' }))).toThrow(ValidationError);
  });

  it('rejects over-long titles (same cap as ManualRecordValidator)', () => {
    expect(() => v.validate(validMsg({ title: 'x'.repeat(10001) }))).toThrow(ValidationError);
  });

  it('rejects unknown cleanseMode (router then reports handled=false)', () => {
    expect(() => v.validate(validMsg({ cleanseMode: 'lax' }))).toThrow(/cleanseMode/);
    expect(() => v.validate(validMsg({ cleanseMode: undefined }))).toThrow(ValidationError);
  });

  it('rejects non-boolean force', () => {
    expect(() => v.validate(validMsg({ force: 'yes' }))).toThrow(ValidationError);
  });

  it('rejects wrong type / missing payload', () => {
    expect(() => v.validate({ ...validMsg(), type: 'MANUAL_RECORD' })).toThrow(ValidationError);
    expect(() => v.validate({ type: 'REGENERATE_SUMMARY', protocolVersion: 1 })).toThrow(ValidationError);
  });

  it('rejects non-numeric protocolVersion', () => {
    expect(() => v.validate({ ...validMsg(), protocolVersion: '1' })).toThrow(ValidationError);
  });
});
