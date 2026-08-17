/**
 * ssrfGuard.test.ts
 * Contract tests for ssrfGuard.ts, imported directly (not via fetch.js
 * re-export) to prove the module is independently testable without any
 * fetch mocking — the value the extraction (PBI-2026-08-17-38) exists for.
 */
import {
  isPrivateIpAddress,
  normalizeIpHostname,
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

    it('resolves an IPv4-mapped IPv6 address to its embedded IPv4 classification', () => {
      expect(isPrivateIpAddress('::ffff:10.0.0.1')).toBe(true);
      expect(isPrivateIpAddress('::ffff:8.8.8.8')).toBe(false);
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
  });

  describe('validateUrlForFilterImport', () => {
    it('blocks a private IPv4 address', () => {
      expect(() => validateUrlForFilterImport('http://10.0.0.1/filters.txt')).toThrow(/private network/);
    });

    it('blocks localhost by hostname', () => {
      expect(() => validateUrlForFilterImport('http://localhost/filters.txt')).toThrow(/localhost is not allowed/);
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

    it('blocks a non-localhost private IP', () => {
      expect(() => validateUrlForAIRequests('http://192.168.1.1/api')).toThrow(/private network/);
    });

    it('allows a public AI provider URL', () => {
      expect(() => validateUrlForAIRequests('https://api.openai.com/v1/chat')).not.toThrow();
    });
  });
});
