/**
 * obsidianClient-ipv6.test.ts
 * _validateHost の IPv6 対応テスト
 * PBI-11: IPv6 ループバック（::1）の許可と、通常ホスト検証の維持
 */

import { ObsidianClient } from '../obsidianClient.js';

describe('ObsidianClient._validateHost - IPv6対応', () => {
  let client: ObsidianClient;

  beforeEach(() => {
    client = new ObsidianClient();
  });

  describe('IPv6アドレスの許可', () => {
    it('allows ::1 (IPv6 loopback) and returns it bracketed for URL construction', () => {
      expect(client._validateHost('::1')).toBe('[::1]');
    });

    it('allows the bracketed [::1] form', () => {
      expect(client._validateHost('[::1]')).toBe('[::1]');
    });

    it('allows global IPv6 addresses', () => {
      expect(client._validateHost('2001:db8::1')).toBe('[2001:db8::1]');
    });

    it('allows IPv4-mapped IPv6 addresses', () => {
      expect(client._validateHost('::ffff:127.0.0.1')).toBe('[::ffff:127.0.0.1]');
    });
  });

  describe('通常ホストの既存検証を維持', () => {
    it('returns the IPv4 loopback as-is', () => {
      expect(client._validateHost('127.0.0.1')).toBe('127.0.0.1');
    });

    it('returns localhost as-is', () => {
      expect(client._validateHost('localhost')).toBe('localhost');
    });

    it('returns regular hostnames as-is', () => {
      expect(client._validateHost('example.com')).toBe('example.com');
    });

    it('returns the default host when empty or unspecified', () => {
      expect(client._validateHost('')).toBe('127.0.0.1');
      expect(client._validateHost(undefined)).toBe('127.0.0.1');
      expect(client._validateHost(null)).toBe('127.0.0.1');
    });
  });

  describe('不正なホストの拒否', () => {
    it('rejects hosts containing spaces', () => {
      expect(() => client._validateHost('foo bar')).toThrow('Obsidian host contains invalid characters.');
    });

    it('rejects hosts containing slashes', () => {
      expect(() => client._validateHost('example.com/path')).toThrow('Obsidian host contains invalid characters.');
    });

    it('rejects hosts containing backslashes', () => {
      expect(() => client._validateHost('example.com\\path')).toThrow('Obsidian host contains invalid characters.');
    });

    it('rejects hosts containing a protocol', () => {
      expect(() => client._validateHost('https://example.com')).toThrow('Obsidian host contains invalid characters.');
    });

    it('rejects colon-containing hosts that are not valid IPv6', () => {
      expect(() => client._validateHost('foo:bar')).toThrow('Obsidian host contains invalid characters.');
    });

    it('rejects bracketed forms containing invalid characters', () => {
      expect(() => client._validateHost('[not:ipv6]')).toThrow('Obsidian host contains invalid characters.');
    });
  });
});
