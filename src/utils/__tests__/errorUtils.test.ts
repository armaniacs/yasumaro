import { describe, it, expect } from 'vitest';
import { errorMessage, toError } from '../errorUtils.js';

describe('errorMessage', () => {
  it('extracts message from Error instance', () => {
    expect(errorMessage(new Error('something broke'))).toBe('something broke');
  });

  it('extracts message from TypeError', () => {
    expect(errorMessage(new TypeError('not a function'))).toBe('not a function');
  });

  it('converts string to string', () => {
    expect(errorMessage('plain string error')).toBe('plain string error');
  });

  it('converts number to string', () => {
    expect(errorMessage(404)).toBe('404');
  });

  it('handles null gracefully', () => {
    expect(errorMessage(null)).toBe('null');
  });

  it('handles undefined gracefully', () => {
    expect(errorMessage(undefined)).toBe('undefined');
  });

  it('converts object to string', () => {
    expect(errorMessage({ code: 500 })).toBe('[object Object]');
  });
});

describe('toError', () => {
  it('returns an Error instance as-is (same reference, stack preserved)', () => {
    const error = new Error('already an error');
    const result = toError(error);
    expect(result).toBe(error);
    expect(result.stack).toBe(error.stack);
  });

  it('returns a TypeError instance as-is (subclass preserved)', () => {
    const error = new TypeError('not a function');
    expect(toError(error)).toBe(error);
  });

  it('wraps a thrown string in an Error carrying that message', () => {
    const result = toError('plain string error');
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('plain string error');
  });

  it('wraps a thrown number in an Error carrying its string form', () => {
    const result = toError(404);
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('404');
  });

  it('wraps null and undefined without throwing', () => {
    expect(toError(null).message).toBe('null');
    expect(toError(undefined).message).toBe('undefined');
  });

  it('wraps an object via its string form', () => {
    const result = toError({ code: 500 });
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('[object Object]');
  });
});
