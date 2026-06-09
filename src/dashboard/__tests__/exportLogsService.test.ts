import { describe, it, expect } from 'vitest';
import { escapeCsv } from '../exportLogsService.js';

describe('escapeCsv', () => {
  it('returns empty string for null/undefined', () => {
    expect(escapeCsv(null)).toBe('');
    expect(escapeCsv(undefined)).toBe('');
  });

  it('returns plain string as-is', () => {
    expect(escapeCsv('hello')).toBe('hello');
    expect(escapeCsv(42)).toBe('42');
    expect(escapeCsv(true)).toBe('true');
  });

  it('wraps strings containing commas', () => {
    expect(escapeCsv('a,b')).toBe('"a,b"');
    expect(escapeCsv('1,2,3')).toBe('"1,2,3"');
  });

  it('wraps strings containing double quotes and escapes them', () => {
    expect(escapeCsv('say "hello"')).toBe('"say ""hello"""');
  });

  it('wraps strings containing newlines', () => {
    expect(escapeCsv('line1\nline2')).toBe('"line1\nline2"');
  });

  it('handles mixed special characters', () => {
    expect(escapeCsv('"hello, world"\nnext')).toBe('"""hello, world""\nnext"');
  });
});
