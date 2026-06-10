import { describe, it, expect } from 'vitest';
import { errorMessage } from '../errorUtils.js';

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
