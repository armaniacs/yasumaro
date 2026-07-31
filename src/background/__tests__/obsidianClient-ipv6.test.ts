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
    it('::1（IPv6ループバック）を許可し、URL組み立て用にブラケット付きで返す', () => {
      expect(client._validateHost('::1')).toBe('[::1]');
    });

    it('[::1] のブラケット付き形式を許可する', () => {
      expect(client._validateHost('[::1]')).toBe('[::1]');
    });

    it('グローバルIPv6アドレスを許可する', () => {
      expect(client._validateHost('2001:db8::1')).toBe('[2001:db8::1]');
    });

    it('IPv4マップIPv6アドレスを許可する', () => {
      expect(client._validateHost('::ffff:127.0.0.1')).toBe('[::ffff:127.0.0.1]');
    });
  });

  describe('通常ホストの既存検証を維持', () => {
    it('IPv4ループバックをそのまま返す', () => {
      expect(client._validateHost('127.0.0.1')).toBe('127.0.0.1');
    });

    it('localhostをそのまま返す', () => {
      expect(client._validateHost('localhost')).toBe('localhost');
    });

    it('通常のホスト名をそのまま返す', () => {
      expect(client._validateHost('example.com')).toBe('example.com');
    });

    it('空・未指定の場合はデフォルトホストを返す', () => {
      expect(client._validateHost('')).toBe('127.0.0.1');
      expect(client._validateHost(undefined)).toBe('127.0.0.1');
      expect(client._validateHost(null)).toBe('127.0.0.1');
    });
  });

  describe('不正なホストの拒否', () => {
    it('スペースを含むホストを拒否する', () => {
      expect(() => client._validateHost('foo bar')).toThrow('Obsidian host contains invalid characters.');
    });

    it('スラッシュを含むホストを拒否する', () => {
      expect(() => client._validateHost('example.com/path')).toThrow('Obsidian host contains invalid characters.');
    });

    it('バックスラッシュを含むホストを拒否する', () => {
      expect(() => client._validateHost('example.com\\path')).toThrow('Obsidian host contains invalid characters.');
    });

    it('プロトコルを含むホストを拒否する', () => {
      expect(() => client._validateHost('https://example.com')).toThrow('Obsidian host contains invalid characters.');
    });

    it('IPv6形式ではないコロン混じりのホストを拒否する', () => {
      expect(() => client._validateHost('foo:bar')).toThrow('Obsidian host contains invalid characters.');
    });

    it('不正な文字を含むブラケット形式を拒否する', () => {
      expect(() => client._validateHost('[not:ipv6]')).toThrow('Obsidian host contains invalid characters.');
    });
  });
});
