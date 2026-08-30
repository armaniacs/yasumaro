/**
 * privacyCheckerHeaderCap.test.ts
 * Attacker-controlled header values must be truncated at the write boundary
 * before they land in a persisted PrivacyInfo.
 */

import { describe, it, expect } from 'vitest';
import { checkPrivacy, MAX_HEADER_VALUE_LENGTH } from '../privacyChecker.js';

function header(name: string, value: string): chrome.webRequest.HttpHeader {
  return { name, value } as chrome.webRequest.HttpHeader;
}

describe('privacyChecker header value cap', () => {
  it('truncates an oversized Cache-Control value to MAX_HEADER_VALUE_LENGTH', () => {
    const huge = 'private, ' + 'a'.repeat(20_000);
    const info = checkPrivacy([header('Cache-Control', huge)]);
    expect(info.headers?.cacheControl?.length).toBe(MAX_HEADER_VALUE_LENGTH);
  });

  it('keeps a value that is exactly MAX_HEADER_VALUE_LENGTH intact', () => {
    const exact = 'private'.padEnd(MAX_HEADER_VALUE_LENGTH, 'x');
    const info = checkPrivacy([header('Cache-Control', exact)]);
    expect(info.headers?.cacheControl).toBe(exact);
  });

  it('leaves a short value untouched', () => {
    const info = checkPrivacy([header('Cache-Control', 'private')]);
    expect(info.headers?.cacheControl).toBe('private');
  });

  it('still detects privacy from a truncated value when the directive is early', () => {
    const huge = 'private, ' + 'a'.repeat(20_000);
    const info = checkPrivacy([header('Cache-Control', huge)]);
    expect(info.isPrivate).toBe(true);
    expect(info.reason).toBe('cache-control');
  });

  it('truncates the cacheControl echo on the non-private branch too', () => {
    const huge = 'public, ' + 'a'.repeat(20_000);
    const info = checkPrivacy([header('Cache-Control', huge)]);
    expect(info.isPrivate).toBe(false);
    expect(info.headers?.cacheControl?.length).toBe(MAX_HEADER_VALUE_LENGTH);
  });
});
