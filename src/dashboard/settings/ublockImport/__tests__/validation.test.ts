import { describe, it, expect } from 'vitest';
import { isValidUrl } from '../validation.js';

describe('isValidUrl', () => {
  it('returns true for valid https URL', () => {
    expect(isValidUrl('https://example.com')).toBe(true);
  });

  it('returns true for valid http URL', () => {
    expect(isValidUrl('http://example.com/path?q=1')).toBe(true);
  });

  it('returns true for valid ftp URL', () => {
    expect(isValidUrl('ftp://files.example.com/file.txt')).toBe(true);
  });

  it('returns false for null', () => {
    expect(isValidUrl(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isValidUrl(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isValidUrl('')).toBe(false);
  });

  it('returns false for javascript: protocol', () => {
    expect(isValidUrl('javascript:alert(1)')).toBe(false);
  });

  it('returns false for data: protocol', () => {
    expect(isValidUrl('data:text/html,<h1>hi</h1>')).toBe(false);
  });

  it('returns false for URL containing control characters', () => {
    expect(isValidUrl('https://example.com/\x00path')).toBe(false);
  });

  it('returns false for URL without protocol separator', () => {
    expect(isValidUrl('example.com')).toBe(false);
  });

  it('returns false when protocol is not http/https/ftp', () => {
    expect(isValidUrl('ws://example.com')).toBe(false);
  });

  // IPv6 valid case — covers L114 (return true in IPv6 branch)
  it('returns true for valid IPv6 URL', () => {
    expect(isValidUrl('http://[::1]/')).toBe(true);
  });

  it('returns true for full IPv6 URL', () => {
    expect(isValidUrl('https://[2001:db8::1]/path')).toBe(true);
  });

  // Empty label case — covers L127 (return false for empty label)
  // and L174 (isValidUrl returns false when hasStrictValidUrlStructure fails)
  it('returns false for URL with consecutive dots in hostname', () => {
    expect(isValidUrl('http://foo..bar/')).toBe(false);
  });

  it('returns false for URL with trailing dot label', () => {
    expect(isValidUrl('http://example.com./')).toBe(false);
  });

  it('returns false for URL with leading dot in hostname', () => {
    expect(isValidUrl('http://.example.com/')).toBe(false);
  });

  it('returns false for URL with label exceeding 63 characters', () => {
    const longLabel = 'a'.repeat(64);
    expect(isValidUrl(`http://${longLabel}.com/`)).toBe(false);
  });

  it('returns false for URL with hyphen-starting label', () => {
    expect(isValidUrl('http://-example.com/')).toBe(false);
  });

  it('returns false for URL with hyphen-ending label', () => {
    expect(isValidUrl('http://example-.com/')).toBe(false);
  });
});
