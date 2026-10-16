/**
 * ssrfGuard.test.ts
 * Contract tests for ssrfGuard.ts, imported directly (not via fetch.js
 * re-export) to prove the module is independently testable without any
 * fetch mocking — the value the extraction (PBI-2026-08-17-38) exists for.
 */
import {
  isPrivateIpAddress,
  normalizeIpHostname,
  normalizeHostname,
  isLocalhostAddress,
  ALLOWED_LOCALHOST_PORTS,
  validateUrl,
  validateUrlForFilterImport,
  validateUrlForAIRequests,
} from '../ssrfGuard.js';

describe('ssrfGuard', () => {
  describe('normalizeIpHostname', () => {
    it('strips brackets from an IPv6 hostname', () => {
      expect(normalizeIpHostname('[::1]')).toBe('::1');
    });

    it('leaves a bare hostname untouched', () => {
      expect(normalizeIpHostname('example.com')).toBe('example.com');
    });
  });

  describe('normalizeHostname', () => {
    it('strips the DNS root trailing dot so the host still matches policy checks', () => {
      expect(normalizeHostname('localhost.')).toBe('localhost');
      expect(normalizeHostname('sub.localhost.')).toBe('sub.localhost');
    });

    it('strips repeated trailing dots', () => {
      expect(normalizeHostname('localhost..')).toBe('localhost');
    });

    it('lowercases and strips brackets', () => {
      expect(normalizeHostname('Example.COM')).toBe('example.com');
      expect(normalizeHostname('[::1]')).toBe('::1');
    });
  });

  describe('isPrivateIpAddress', () => {
    it('classifies RFC 1918 IPv4 ranges as private', () => {
      expect(isPrivateIpAddress('10.0.0.1')).toBe(true);
      expect(isPrivateIpAddress('172.16.0.1')).toBe(true);
      expect(isPrivateIpAddress('172.31.255.255')).toBe(true);
      expect(isPrivateIpAddress('192.168.1.1')).toBe(true);
      expect(isPrivateIpAddress('127.0.0.1')).toBe(true);
      expect(isPrivateIpAddress('169.254.169.254')).toBe(true); // cloud metadata
    });

    it('does not classify a public IPv4 address as private', () => {
      expect(isPrivateIpAddress('8.8.8.8')).toBe(false);
    });

    it('rejects out-of-range IPv4 octets rather than treating them as private', () => {
      expect(isPrivateIpAddress('999.999.999.999')).toBe(false);
    });

    it('classifies IPv6 loopback (::1) as private', () => {
      expect(isPrivateIpAddress('::1')).toBe(true);
      expect(isPrivateIpAddress('[::1]')).toBe(true);
    });

    it('classifies the IPv6 unspecified address (::) as private', () => {
      // IPv4 の 0.0.0.0 と同様に「このホスト」表現。許可すると SSRF 経路になる。
      expect(isPrivateIpAddress('::')).toBe(true);
      expect(isPrivateIpAddress('[::]')).toBe(true);
      expect(isPrivateIpAddress('0:0:0:0:0:0:0:0')).toBe(true);
    });

    it('resolves an IPv4-mapped IPv6 address to its embedded IPv4 classification', () => {
      expect(isPrivateIpAddress('::ffff:10.0.0.1')).toBe(true);
      expect(isPrivateIpAddress('::ffff:8.8.8.8')).toBe(false);
    });

    it('resolves a NAT64 well-known-prefix address to its embedded IPv4 classification', () => {
      expect(isPrivateIpAddress('64:ff9b::7f00:1')).toBe(true);   // 127.0.0.1
      expect(isPrivateIpAddress('64:ff9b::a00:1')).toBe(true);    // 10.0.0.1
      expect(isPrivateIpAddress('64:ff9b::808:808')).toBe(false); // 8.8.8.8
    });

    it('classifies fe80::/10 link-local addresses as private', () => {
      expect(isPrivateIpAddress('fe80::1')).toBe(true);
    });

    it('classifies fc00::/7 unique local addresses as private', () => {
      expect(isPrivateIpAddress('fc00::1')).toBe(true);
      expect(isPrivateIpAddress('fd00::1')).toBe(true);
    });
  });

  describe('isLocalhostAddress', () => {
    it('recognizes localhost and 127.x.x.x as localhost', () => {
      expect(isLocalhostAddress('localhost')).toBe(true);
      expect(isLocalhostAddress('127.0.0.1')).toBe(true);
      expect(isLocalhostAddress('::1')).toBe(true);
    });

    it('recognizes the IPv6 unspecified address (::) as localhost', () => {
      expect(isLocalhostAddress('::')).toBe(true);
      expect(isLocalhostAddress('[::]')).toBe(true);
      // ポート許可リストは :: にも適用される（VULN-013 と同じ扱い）
      expect(isLocalhostAddress('::', 9999)).toBe(false);
    });

    it('rejects a non-localhost hostname', () => {
      expect(isLocalhostAddress('example.com')).toBe(false);
    });

    it('only trusts localhost when the port is on the allowlist (VULN-013)', () => {
      for (const port of ALLOWED_LOCALHOST_PORTS) {
        expect(isLocalhostAddress('127.0.0.1', port)).toBe(true);
      }
      expect(isLocalhostAddress('127.0.0.1', 9999)).toBe(false);
    });
  });

  describe('validateUrl', () => {
    it('rejects an unsupported protocol', () => {
      expect(() => validateUrl('ftp://example.com')).toThrow(/Unsupported protocol/);
    });

    it('allows http/https by default', () => {
      expect(() => validateUrl('https://example.com')).not.toThrow();
      expect(() => validateUrl('http://example.com')).not.toThrow();
    });

    it('does not block localhost by default', () => {
      expect(() => validateUrl('http://localhost:8080')).not.toThrow();
    });

    it('does not throw for a normal hostname when blockLocalhost=true', () => {
      expect(() => validateUrl('https://example.com', { blockLocalhost: true })).not.toThrow();
    });

    it('blocks localhost with a DNS root trailing dot when blockLocalhost=true', () => {
      expect(() => validateUrl('http://localhost./', { blockLocalhost: true })).toThrow(/localhost/);
      expect(() => validateUrl('http://localhost../', { blockLocalhost: true })).toThrow(/localhost/);
      expect(() => validateUrl('http://sub.localhost./', { blockLocalhost: true })).toThrow(/localhost/);
    });

    it('blocks loopback written as a decimal or hex IPv4 literal when blockLocalhost=true', () => {
      // `new URL()` canonicalizes these to 127.0.0.1, so the IP classification
      // must catch them without any extra numeric-form parsing.
      expect(() => validateUrl('http://2130706433/', { blockLocalhost: true })).toThrow(/private network/);
      expect(() => validateUrl('http://0x7f000001/', { blockLocalhost: true })).toThrow(/private network/);
    });

    it('still allows a public hostname that ends with a trailing dot', () => {
      expect(() => validateUrl('https://example.com./', { blockLocalhost: true })).not.toThrow();
    });
  });

  describe('validateUrlForFilterImport', () => {
    it('blocks a private IPv4 address', () => {
      expect(() => validateUrlForFilterImport('http://10.0.0.1/filters.txt')).toThrow(/private network/);
    });

    it('blocks localhost by hostname', () => {
      expect(() => validateUrlForFilterImport('http://localhost/filters.txt')).toThrow(/localhost is not allowed/);
    });

    it('blocks localhost by hostname with a trailing dot', () => {
      expect(() => validateUrlForFilterImport('http://localhost./filters.txt')).toThrow(/localhost is not allowed/);
    });

    it('allows a public URL', () => {
      expect(() => validateUrlForFilterImport('https://example.com/filters.txt')).not.toThrow();
    });
  });

  describe('validateUrlForAIRequests', () => {
    it('allows localhost on an allowed port (local AI providers)', () => {
      expect(() => validateUrlForAIRequests('http://127.0.0.1:11434/api/generate')).not.toThrow();
    });

    it('blocks localhost on a non-allowed port', () => {
      expect(() => validateUrlForAIRequests('http://127.0.0.1:9999/api/generate')).toThrow(/private network/);
    });

    it('applies the port allowlist to the localhost hostname form too', () => {
      expect(() => validateUrlForAIRequests('http://localhost:11434/api/generate')).not.toThrow();
      expect(() => validateUrlForAIRequests('http://localhost:9999/api/generate')).toThrow(/private network/);
    });

    it('applies the port allowlist to a trailing-dot localhost host', () => {
      expect(() => validateUrlForAIRequests('http://localhost.:11434/api/generate')).not.toThrow();
      expect(() => validateUrlForAIRequests('http://localhost.:9999/api/generate')).toThrow(/private network/);
    });

    it('blocks a non-localhost private IP', () => {
      expect(() => validateUrlForAIRequests('http://192.168.1.1/api')).toThrow(/private network/);
    });

    it('allows a public AI provider URL', () => {
      expect(() => validateUrlForAIRequests('https://api.openai.com/v1/chat')).not.toThrow();
    });
  });

  describe('IPv6 unspecified [::] blocking (SSRF regression)', () => {
    it('rejects http://[::]:9999/ at validateUrl (blockLocalhost=true)', () => {
      expect(() => validateUrl('http://[::]:9999/', { blockLocalhost: true })).toThrow(/private network/);
    });

    it('rejects http://[::]:9999/ at validateUrlForFilterImport', () => {
      expect(() => validateUrlForFilterImport('http://[::]:9999/')).toThrow(/private network/);
    });

    it('rejects http://[::]:9999/ at validateUrlForAIRequests', () => {
      expect(() => validateUrlForAIRequests('http://[::]:9999/')).toThrow(/private network/);
    });

    it('treats :: like 127.0.0.1 at validateUrlForAIRequests: port allowlist applies', () => {
      expect(() => validateUrlForAIRequests('http://[::]:11434/api/generate')).not.toThrow();
      expect(() => validateUrlForAIRequests('http://[::]:9999/api/generate')).toThrow(/private network/);
    });

    it('keeps the ::1 loopback handling intact at every entry point', () => {
      // [0:0:0:0:0:0:0:1] は URL パーサにより [::1] に正規化される
      expect(() => validateUrl('http://[0:0:0:0:0:0:0:1]:9999/', { blockLocalhost: true })).toThrow(/private network/);
      expect(() => validateUrlForFilterImport('http://[0:0:0:0:0:0:0:1]:9999/')).toThrow(/private network/);
      expect(() => validateUrlForAIRequests('http://[0:0:0:0:0:0:0:1]:9999/')).toThrow(/private network/);
      // ::1 はローカルAI用途では許可ポートなら従来どおり許可される
      expect(() => validateUrlForAIRequests('http://[::1]:11434/api/generate')).not.toThrow();
    });

    it('keeps public URLs allowed at every entry point', () => {
      expect(() => validateUrl('https://example.com', { blockLocalhost: true })).not.toThrow();
      expect(() => validateUrlForFilterImport('https://example.com/filters.txt')).not.toThrow();
      expect(() => validateUrlForAIRequests('https://api.openai.com/v1/chat')).not.toThrow();
    });
  });
});
