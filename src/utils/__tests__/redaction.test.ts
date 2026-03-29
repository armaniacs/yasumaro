/**
 * redaction.ts のテスト
 */

import { redactHeaderValue, SENSITIVE_HEADER_REASONS } from '../redaction.js';

describe('redactHeaderValue', () => {
  describe('authorization reason', () => {
    it('authorization の場合は [REDACTED] を返す', () => {
      expect(redactHeaderValue('Bearer secret-token-abc123', 'authorization')).toBe('[REDACTED]');
    });

    it('空文字列の authorization でも [REDACTED] を返す', () => {
      expect(redactHeaderValue('', 'authorization')).toBe('[REDACTED]');
    });
  });

  describe('非機密 reason', () => {
    it('cache-control の場合は元の値をそのまま返す', () => {
      expect(redactHeaderValue('private, no-store', 'cache-control')).toBe('private, no-store');
    });

    it('set-cookie の場合は元の値をそのまま返す', () => {
      expect(redactHeaderValue('session=abc; HttpOnly', 'set-cookie')).toBe('session=abc; HttpOnly');
    });

    it('未知の reason の場合は元の値をそのまま返す', () => {
      expect(redactHeaderValue('some-value', 'unknown-reason')).toBe('some-value');
    });

    it('空文字列 reason の場合は元の値をそのまま返す', () => {
      expect(redactHeaderValue('some-value', '')).toBe('some-value');
    });
  });

  describe('SENSITIVE_HEADER_REASONS', () => {
    it('authorization が含まれている', () => {
      expect(SENSITIVE_HEADER_REASONS).toContain('authorization');
    });
  });
});
