/**
 * ssrfDnsPinning.test.ts
 * PBI 2026-11-08-01: SSRFガードのDNSピン留めとlocalhost既定拒否の回帰テスト。
 * BDD 4シナリオ (公開ホスト成功 / DNS切替え拒否 / 既定localhost拒否 /
 * http内部ホスト拒否) を、注入したDNS resolver と fetch スタブで検証する。
 * 実時間待ちなし・実DNS問い合わせなし。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../logger/api.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    logDebug: vi.fn().mockResolvedValue(undefined),
    logWarn: vi.fn().mockResolvedValue(undefined),
  };
});

import {
  fetchWithTimeout,
  validateUrlForFilterImport,
  validateUrlForFilterImportAsync,
} from '../fetch.js';

function okResponse(): Response {
  return { ok: true, status: 200 } as Response;
}

describe('ssrfDnsPinning', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('public https host (BDD happy path)', () => {
    it('succeeds when the resolver keeps returning the same public IP', async () => {
      const resolveHostname = vi.fn(async (_host: string) => ['93.184.216.34']);

      const response = await fetchWithTimeout('https://example.com/filters.txt', {
        skipCspValidation: true,
        resolveHostname,
      });

      expect(response.ok).toBe(true);
      expect(resolveHostname).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('returns the pin from the async filter-import guard', async () => {
      const resolveHostname = vi.fn(async (_host: string) => ['93.184.216.34']);

      const pinned = await validateUrlForFilterImportAsync('https://example.com/filters.txt', {
        resolveHostname,
      });

      expect(pinned?.ips).toEqual(['93.184.216.34']);
      expect(pinned?.hostname).toBe('example.com');
    });

    it('returns null when no resolver is given (string check only)', async () => {
      const pinned = await validateUrlForFilterImportAsync('https://example.com/filters.txt');

      expect(pinned).toBeNull();
    });
  });

  describe('DNS switching to loopback after validation (BDD error path)', () => {
    it('rejects when the post-connection resolution turns loopback', async () => {
      let calls = 0;
      const resolveHostname = vi.fn(async (_host: string) => {
        calls += 1;
        return calls === 1 ? ['93.184.216.34'] : ['127.0.0.1'];
      });

      await expect(
        fetchWithTimeout('https://evil.example/filters.txt', {
          skipCspValidation: true,
          resolveHostname,
        }),
      ).rejects.toThrow(/private|loopback|mismatch|rebinding/i);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rejects when the post-connection resolution changes to another public IP', async () => {
      let calls = 0;
      const resolveHostname = vi.fn(async (_host: string) => {
        calls += 1;
        return calls === 1 ? ['93.184.216.34'] : ['93.184.216.35'];
      });

      await expect(
        fetchWithTimeout('https://evil.example/filters.txt', {
          skipCspValidation: true,
          resolveHostname,
        }),
      ).rejects.toThrow(/mismatch|rebinding/i);
    });

    it('rejects at guard time when the name already resolves to loopback', async () => {
      const resolveHostname = vi.fn(async (_host: string) => ['127.0.0.1']);

      await expect(
        validateUrlForFilterImportAsync('https://evil.example/filters.txt', {
          resolveHostname,
        }),
      ).rejects.toThrow(/private|loopback/i);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fails closed when the name does not resolve at all', async () => {
      const resolveHostname = vi.fn(async (_host: string) => [] as string[]);

      await expect(
        validateUrlForFilterImportAsync('https://evil.example/filters.txt', {
          resolveHostname,
        }),
      ).rejects.toThrow(/no addresses resolved/i);
    });
  });

  describe('pin reuse across the guard and the connection (No.3/No.4/No.5)', () => {
    it('resolves only after connect when the caller passes the guard pin', async () => {
      const resolveHostname = vi.fn(async (_host: string) => ['93.184.216.34']);

      const pinned = await validateUrlForFilterImportAsync('https://example.com/filters.txt', {
        resolveHostname,
      });
      expect(pinned).not.toBeNull();
      expect(resolveHostname).toHaveBeenCalledTimes(1);

      const response = await fetchWithTimeout('https://example.com/filters.txt', {
        skipCspValidation: true,
        dnsPin: pinned!,
      });

      expect(response.ok).toBe(true);
      // No pre-connection resolution: the guard pin is reused, only the
      // post-connection stability check resolves again.
      expect(resolveHostname).toHaveBeenCalledTimes(2);
    });

    it('passes a normalized hostname to the resolver on both halves (S8)', async () => {
      const seen: string[] = [];
      const resolveHostname = vi.fn(async (host: string) => {
        seen.push(host);
        return ['93.184.216.34'];
      });

      const response = await fetchWithTimeout('https://EXAMPLE.COM./filters.txt', {
        skipCspValidation: true,
        resolveHostname,
      });

      expect(response.ok).toBe(true);
      expect(seen).toEqual(['example.com', 'example.com']);
    });
  });

  describe('localhost by default (BDD boundary)', () => {
    it('rejects a literal 127.0.0.1 without any explicit option', async () => {
      await expect(
        fetchWithTimeout('http://127.0.0.1:8080/status', { skipCspValidation: true }),
      ).rejects.toThrow(/private network|localhost/i);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects a localhost hostname without any explicit option', async () => {
      await expect(
        fetchWithTimeout('http://localhost:8080/status', { skipCspValidation: true }),
      ).rejects.toThrow(/localhost/i);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('still allows loopback when the caller explicitly opts out (Obsidian/local AI)', async () => {
      const response = await fetchWithTimeout('http://127.0.0.1:27123/', {
        skipCspValidation: true,
        blockLocalhost: false,
      });

      expect(response.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('http internal host (BDD error path)', () => {
    it('rejects http URLs to private IPv4 literals at the filter-import guard', () => {
      expect(() => validateUrlForFilterImport('http://10.0.0.1/filters.txt')).toThrow(
        /private network/,
      );
      expect(() => validateUrlForFilterImport('http://192.168.1.1/filters.txt')).toThrow(
        /private network/,
      );
    });

    it('rejects http URLs to loopback at the filter-import guard', () => {
      expect(() => validateUrlForFilterImport('http://127.0.0.1:9222/json')).toThrow(
        /private network|localhost/,
      );
      expect(() => validateUrlForFilterImport('http://localhost/filters.txt')).toThrow(/localhost/);
    });

    it('rejects an http private address on the default fetch path', async () => {
      await expect(
        fetchWithTimeout('http://192.168.1.1/admin', { skipCspValidation: true }),
      ).rejects.toThrow(/private network/i);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
