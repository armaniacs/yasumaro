import { describe, it, expect } from 'vitest';
import { reasonToStatusCode, statusCodeToMessageKey, PrivacyStatusCode } from '../privacyStatusCodes.js';

describe('privacyStatusCodes', () => {
  describe('reasonToStatusCode', () => {
    it('returns CACHE_CONTROL for cache-control reason', () => {
      expect(reasonToStatusCode('cache-control')).toBe(PrivacyStatusCode.CACHE_CONTROL);
    });

    it('returns SET_COOKIE for set-cookie reason', () => {
      expect(reasonToStatusCode('set-cookie')).toBe(PrivacyStatusCode.SET_COOKIE);
    });

    it('returns AUTHORIZATION for authorization reason', () => {
      expect(reasonToStatusCode('authorization')).toBe(PrivacyStatusCode.AUTHORIZATION);
    });

    it('returns UNKNOWN for unknown reason', () => {
      expect(reasonToStatusCode('unknown')).toBe(PrivacyStatusCode.UNKNOWN);
    });

    it('returns UNKNOWN for undefined reason', () => {
      expect(reasonToStatusCode(undefined)).toBe(PrivacyStatusCode.UNKNOWN);
    });
  });

  describe('statusCodeToMessageKey', () => {
    it('returns correct message key for CACHE_CONTROL', () => {
      expect(statusCodeToMessageKey(PrivacyStatusCode.CACHE_CONTROL)).toBe('privacyStatus_cacheControl');
    });

    it('returns correct message key for SET_COOKIE', () => {
      expect(statusCodeToMessageKey(PrivacyStatusCode.SET_COOKIE)).toBe('privacyStatus_setCookie');
    });

    it('returns correct message key for AUTHORIZATION', () => {
      expect(statusCodeToMessageKey(PrivacyStatusCode.AUTHORIZATION)).toBe('privacyStatus_authorization');
    });

    it('returns correct message key for UNKNOWN', () => {
      expect(statusCodeToMessageKey(PrivacyStatusCode.UNKNOWN)).toBe('privacyStatus_unknown');
    });
  });
});
