/**
 * checkPrivacyHeadersStep (PrivacyHeadersChecker) のテスト
 *
 * 修正された問題:
 *   force=true の場合でも AUTO_SAVE_PRIVACY_BEHAVIOR='skip'/'confirm' の設定で
 *   PRIVATE_PAGE_DETECTED エラーが throw されていた。
 *   ユーザーが「それでも記録」を選択した際に記録できない問題を修正済み。
 */

import { vi } from 'vitest';;

vi.mock('../../../../utils/logger/types.js');;vi.mock('../../../../utils/logger/core.js');;vi.mock('../../../../utils/logger/api.js');
vi.mock('../../../../utils/storage/types.js');
vi.mock('../../../../utils/storage/defaults.js');
vi.mock('../../../../utils/storage/encryptionSession.js');
vi.mock('../../../../utils/storage/savedUrlRepository.js');
vi.mock('../../../../utils/storage/domainFilterCache.js');
vi.mock('../../../../utils/storage/quota.js');
vi.mock('../../../../utils/pendingStorage.js', async (importOriginal) => {
  // Keep the real pure builder so the step <-> buildPendingPage integration
  // is exercised; only the storage I/O (addPendingPage) stays mocked.
  const actual = await importOriginal<typeof import('../../../../utils/pendingStorage.js')>();
  return { ...actual, addPendingPage: vi.fn().mockResolvedValue(undefined) };
});

import { PrivacyHeadersChecker, PrivatePageError } from '../checkPrivacyHeadersStep.js';
import { StorageKeys } from '../../../../utils/storage/types.js';
import * as pendingStorage from '../../../../utils/pendingStorage.js';
import { addLog } from '../../../../utils/logger/core.js';
import type { RecordingContext } from '../../types.js';

function makeContext(overrides: Partial<RecordingContext> = {}): RecordingContext {
  return {
    data: {
      title: 'Test Page',
      url: 'https://example.com',
      content: 'Some page content',
      force: false,
    },
    settings: {
      [StorageKeys.DOMAIN_WHITELIST]: [],
      [StorageKeys.AUTO_SAVE_PRIVACY_BEHAVIOR]: 'save',
    } as any,
    force: false,
    errors: [],
    ...overrides,
  };
}

describe('PrivacyHeadersChecker', () => {
  describe('force=true の場合', () => {
    it('skips the privacy check and allows recording even when AUTO_SAVE_PRIVACY_BEHAVIOR=skip', async () => {
      const getPrivacyInfo = vi.fn<() => Promise<any>>().mockResolvedValue({
        isPrivate: true,
        reason: 'cache-control',
        headers: { cacheControl: 'private, no-store' },
      });
      const checker = new PrivacyHeadersChecker(getPrivacyInfo);

      const context = makeContext({
        force: true,
        data: {
          title: 'Test',
          url: 'https://example.com',
          content: '',
          force: true,
        },
        settings: {
          [StorageKeys.DOMAIN_WHITELIST]: [],
          [StorageKeys.AUTO_SAVE_PRIVACY_BEHAVIOR]: 'skip',
        } as any,
      });

      await expect(checker.execute(context)).resolves.toBe(context);
    });

    it('skips the privacy check and allows recording even when AUTO_SAVE_PRIVACY_BEHAVIOR=confirm', async () => {
      const getPrivacyInfo = vi.fn<() => Promise<any>>().mockResolvedValue({
        isPrivate: true,
        reason: 'cache-control',
        headers: { cacheControl: 'private' },
      });
      const checker = new PrivacyHeadersChecker(getPrivacyInfo);

      const context = makeContext({
        force: true,
        data: {
          title: 'Test',
          url: 'https://example.com',
          content: '',
          force: true,
        },
        settings: {
          [StorageKeys.DOMAIN_WHITELIST]: [],
          [StorageKeys.AUTO_SAVE_PRIVACY_BEHAVIOR]: 'confirm',
        } as any,
      });

      await expect(checker.execute(context)).resolves.toBe(context);
    });

    it('passes normally when force=true and isPrivate=false', async () => {
      const getPrivacyInfo = vi.fn<() => Promise<any>>().mockResolvedValue({
        isPrivate: false,
      });
      const checker = new PrivacyHeadersChecker(getPrivacyInfo);

      const context = makeContext({ force: true });

      await expect(checker.execute(context)).resolves.toBe(context);
    });
  });

  describe('force=false の場合', () => {
    it('throws PRIVATE_PAGE_DETECTED when AUTO_SAVE_PRIVACY_BEHAVIOR=skip', async () => {
      const getPrivacyInfo = vi.fn<() => Promise<any>>().mockResolvedValue({
        isPrivate: true,
        reason: 'cache-control',
        headers: { cacheControl: 'private, no-store' },
      });
      const checker = new PrivacyHeadersChecker(getPrivacyInfo);

      const context = makeContext({
        force: false,
        settings: {
          [StorageKeys.DOMAIN_WHITELIST]: [],
          [StorageKeys.AUTO_SAVE_PRIVACY_BEHAVIOR]: 'skip',
        } as any,
      });

      await expect(checker.execute(context)).rejects.toThrow('PRIVATE_PAGE_DETECTED');
    });

    it('passes normally when AUTO_SAVE_PRIVACY_BEHAVIOR=save', async () => {
      const getPrivacyInfo = vi.fn<() => Promise<any>>().mockResolvedValue({
        isPrivate: true,
        reason: 'cache-control',
        headers: { cacheControl: 'private' },
      });
      const checker = new PrivacyHeadersChecker(getPrivacyInfo);

      const context = makeContext({
        force: false,
        settings: {
          [StorageKeys.DOMAIN_WHITELIST]: [],
          [StorageKeys.AUTO_SAVE_PRIVACY_BEHAVIOR]: 'save',
        } as any,
      });

      await expect(checker.execute(context)).resolves.toBe(context);
    });

    it('passes normally when isPrivate=false', async () => {
      const getPrivacyInfo = vi.fn<() => Promise<any>>().mockResolvedValue({
        isPrivate: false,
      });
      const checker = new PrivacyHeadersChecker(getPrivacyInfo);

      const context = makeContext({ force: false });

      await expect(checker.execute(context)).resolves.toBe(context);
    });
  });

  describe('ホワイトリスト', () => {
    it('skips the privacy check for whitelisted domains', async () => {
      const getPrivacyInfo = vi.fn<() => Promise<any>>().mockResolvedValue({
        isPrivate: true,
        reason: 'cache-control',
      });
      const checker = new PrivacyHeadersChecker(getPrivacyInfo);

      const context = makeContext({
        force: false,
        data: {
          title: 'Test',
          url: 'https://example.com/page',
          content: '',
        },
        settings: {
          [StorageKeys.DOMAIN_WHITELIST]: ['example.com'],
          [StorageKeys.AUTO_SAVE_PRIVACY_BEHAVIOR]: 'skip',
        } as any,
      });

      await expect(checker.execute(context)).resolves.toBe(context);
    });

    it('matches wildcard whitelist entries added via the popup writer', async () => {
      const getPrivacyInfo = vi.fn<() => Promise<any>>().mockResolvedValue({
        isPrivate: true,
        reason: 'cache-control',
      });
      const checker = new PrivacyHeadersChecker(getPrivacyInfo);

      const context = makeContext({
        force: false,
        data: {
          title: 'Test',
          url: 'https://sub.example.com/page',
          content: '',
        },
        settings: {
          [StorageKeys.DOMAIN_WHITELIST]: ['*.example.com'],
          [StorageKeys.AUTO_SAVE_PRIVACY_BEHAVIOR]: 'skip',
        } as any,
      });

      await expect(checker.execute(context)).resolves.toBe(context);
    });

    it('does not match subdomains from a plain entry unless DOMAIN_SUBDOMAIN_MATCHING is on', async () => {
      const getPrivacyInfo = vi.fn<() => Promise<any>>().mockResolvedValue({
        isPrivate: true,
        reason: 'cache-control',
      });
      const checker = new PrivacyHeadersChecker(getPrivacyInfo);

      const base = {
        force: false,
        data: {
          title: 'Test',
          url: 'https://sub.example.com/page',
          content: '',
        },
      };

      // 既定（サブドメイン一致 OFF）ではプレーンなエントリに sub.example.com は一致しない
      const strictContext = makeContext({
        ...base,
        settings: {
          [StorageKeys.DOMAIN_WHITELIST]: ['example.com'],
          [StorageKeys.DOMAIN_SUBDOMAIN_MATCHING]: false,
          [StorageKeys.AUTO_SAVE_PRIVACY_BEHAVIOR]: 'skip',
        } as any,
      });
      await expect(checker.execute(strictContext)).rejects.toThrow();

      // DOMAIN_SUBDOMAIN_MATCHING=true なら一致する
      const subdomainContext = makeContext({
        ...base,
        settings: {
          [StorageKeys.DOMAIN_WHITELIST]: ['example.com'],
          [StorageKeys.DOMAIN_SUBDOMAIN_MATCHING]: true,
          [StorageKeys.AUTO_SAVE_PRIVACY_BEHAVIOR]: 'skip',
        } as any,
      });
      await expect(checker.execute(subdomainContext)).resolves.toBe(subdomainContext);
    });
  });

  describe('headerValue のマスク処理', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      // @ts-expect-error - vi.fn() type narrowing
      (pendingStorage.addPendingPage as vi.Mock).mockResolvedValue(undefined);
    });

    it('stores headerValue as [REDACTED] for the authorization reason', async () => {
      const getPrivacyInfo = vi.fn<() => Promise<any>>().mockResolvedValue({
        isPrivate: true,
        reason: 'authorization',
      });
      const checker = new PrivacyHeadersChecker(getPrivacyInfo);

      const context = makeContext({
        force: false,
        data: {
          title: 'Auth Page',
          url: 'https://api.example.com/data',
          content: '',
          headerValue: 'Bearer secret-token-abc123',
        },
        settings: {
          [StorageKeys.DOMAIN_WHITELIST]: [],
          [StorageKeys.AUTO_SAVE_PRIVACY_BEHAVIOR]: 'skip',
        } as any,
      });

      await expect(checker.execute(context)).rejects.toThrow('PRIVATE_PAGE_DETECTED');
      expect(pendingStorage.addPendingPage).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'authorization',
          headerValue: '[REDACTED]',
        })
      );
    });

    it('stores headerValue as-is for the cache-control reason', async () => {
      const getPrivacyInfo = vi.fn<() => Promise<any>>().mockResolvedValue({
        isPrivate: true,
        reason: 'cache-control',
        headers: { cacheControl: 'private, no-store' },
      });
      const checker = new PrivacyHeadersChecker(getPrivacyInfo);

      const context = makeContext({
        force: false,
        data: {
          title: 'Private Page',
          url: 'https://example.com/private',
          content: '',
          headerValue: 'private, no-store',
        },
        settings: {
          [StorageKeys.DOMAIN_WHITELIST]: [],
          [StorageKeys.AUTO_SAVE_PRIVACY_BEHAVIOR]: 'skip',
        } as any,
      });

      await expect(checker.execute(context)).rejects.toThrow('PRIVATE_PAGE_DETECTED');
      expect(pendingStorage.addPendingPage).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'cache-control',
          headerValue: 'private, no-store',
        })
      );
    });

    it('stores [REDACTED] for requireConfirmation=true with authorization', async () => {
      const getPrivacyInfo = vi.fn<() => Promise<any>>().mockResolvedValue({
        isPrivate: true,
        reason: 'authorization',
      });
      const checker = new PrivacyHeadersChecker(getPrivacyInfo);

      const context = makeContext({
        force: false,
        data: {
          title: 'Auth Page',
          url: 'https://api.example.com/data',
          content: '',
          headerValue: 'Bearer secret-token-abc123',
          requireConfirmation: true,
        },
        settings: {
          [StorageKeys.DOMAIN_WHITELIST]: [],
          [StorageKeys.AUTO_SAVE_PRIVACY_BEHAVIOR]: 'save',
        } as any,
      });

      await expect(checker.execute(context)).rejects.toThrow('PRIVATE_PAGE_DETECTED');
      expect(pendingStorage.addPendingPage).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'authorization',
          headerValue: '[REDACTED]',
        })
      );
    });
  });

  describe('PBI 2026-09-21-28 pinning: fetch-skip + deny payloads (byte-equal)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      // @ts-expect-error - vi.fn() type narrowing
      (pendingStorage.addPendingPage as vi.Mock).mockResolvedValue(undefined);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('force=true skips the fetch entirely (getPrivacyInfoWithCache NOT called)', async () => {
      const getPrivacyInfo = vi.fn<() => Promise<any>>().mockResolvedValue({ isPrivate: true });
      const checker = new PrivacyHeadersChecker(getPrivacyInfo);
      const context = makeContext({ force: true });

      await expect(checker.execute(context)).resolves.toBe(context);
      expect(getPrivacyInfo).not.toHaveBeenCalled();
      expect(addLog).toHaveBeenCalledWith(
        expect.anything(),
        'Force recording - bypassing privacy check',
        expect.objectContaining({ url: 'https://example.com' })
      );
    });

    it('whitelisted domain skips the fetch entirely (getPrivacyInfoWithCache NOT called)', async () => {
      const getPrivacyInfo = vi.fn<() => Promise<any>>().mockResolvedValue({ isPrivate: true });
      const checker = new PrivacyHeadersChecker(getPrivacyInfo);
      const context = makeContext({
        force: false,
        data: { title: 'Test', url: 'https://example.com/page', content: '' },
        settings: {
          [StorageKeys.DOMAIN_WHITELIST]: ['example.com'],
          [StorageKeys.AUTO_SAVE_PRIVACY_BEHAVIOR]: 'skip',
        } as any,
      });

      await expect(checker.execute(context)).resolves.toBe(context);
      expect(getPrivacyInfo).not.toHaveBeenCalled();
      expect(addLog).toHaveBeenCalledWith(
        expect.anything(),
        'Whitelisted domain, bypassing privacy check',
        expect.objectContaining({ url: 'https://example.com/page' })
      );
    });

    it('non-private page after fetch continues without pending save', async () => {
      const getPrivacyInfo = vi.fn<() => Promise<any>>().mockResolvedValue({ isPrivate: false });
      const checker = new PrivacyHeadersChecker(getPrivacyInfo);
      const context = makeContext({ force: false });

      await expect(checker.execute(context)).resolves.toBe(context);
      expect(getPrivacyInfo).toHaveBeenCalledTimes(1);
      expect(pendingStorage.addPendingPage).not.toHaveBeenCalled();
    });

    it('deniedBy=skip saves the exact pending args and throws reason-only payload', async () => {
      const T0 = 1726876800000;
      vi.useFakeTimers();
      vi.setSystemTime(T0);
      const getPrivacyInfo = vi.fn<() => Promise<any>>().mockResolvedValue({
        isPrivate: true,
        reason: 'cache-control',
        headers: { cacheControl: 'private, no-store' },
      });
      const checker = new PrivacyHeadersChecker(getPrivacyInfo);
      const context = makeContext({
        force: false,
        data: { title: 'Private', url: 'https://example.com/private', content: '' },
        settings: {
          [StorageKeys.DOMAIN_WHITELIST]: [],
          [StorageKeys.AUTO_SAVE_PRIVACY_BEHAVIOR]: 'skip',
        } as any,
      });

      const err = await checker.execute(context).catch((e) => e);
      expect(err).toBeInstanceOf(PrivatePageError);
      expect(err.message).toBe('PRIVATE_PAGE_DETECTED');
      expect(err.reason).toBe('cache-control');
      expect(err.confirmationRequired).toBeUndefined();
      expect(err.headerValue).toBeUndefined();
      expect(pendingStorage.addPendingPage).toHaveBeenCalledTimes(1);
      expect(pendingStorage.addPendingPage).toHaveBeenCalledWith({
        url: 'https://example.com/private',
        title: 'Private',
        timestamp: T0,
        reason: 'cache-control',
        headerValue: 'private, no-store',
        expiry: T0 + 24 * 60 * 60 * 1000,
      });
    });

    it('deniedBy=requireConfirmation throws confirmation payload WITHOUT headerValue', async () => {
      const T0 = 1726876800000;
      vi.useFakeTimers();
      vi.setSystemTime(T0);
      const getPrivacyInfo = vi.fn<() => Promise<any>>().mockResolvedValue({
        isPrivate: true,
        reason: 'set-cookie',
      });
      const checker = new PrivacyHeadersChecker(getPrivacyInfo);
      const context = makeContext({
        force: false,
        data: {
          title: 'Cookie Page',
          url: 'https://example.com/cookie',
          content: '',
          headerValue: 'session=abc',
          requireConfirmation: true,
        },
        settings: {
          [StorageKeys.DOMAIN_WHITELIST]: [],
          [StorageKeys.AUTO_SAVE_PRIVACY_BEHAVIOR]: 'save',
        } as any,
      });

      const err = await checker.execute(context).catch((e) => e);
      expect(err).toBeInstanceOf(PrivatePageError);
      expect(err.confirmationRequired).toBe(true);
      expect(err.headerValue).toBeUndefined();
      expect(err.reason).toBe('set-cookie');
      expect(pendingStorage.addPendingPage).toHaveBeenCalledWith({
        url: 'https://example.com/cookie',
        title: 'Cookie Page',
        timestamp: T0,
        reason: 'set-cookie',
        headerValue: 'session=abc',
        expiry: T0 + 24 * 60 * 60 * 1000,
      });
    });

    it('deniedBy=confirm throws confirmation payload WITH headerValue', async () => {
      const T0 = 1726876800000;
      vi.useFakeTimers();
      vi.setSystemTime(T0);
      const getPrivacyInfo = vi.fn<() => Promise<any>>().mockResolvedValue({
        isPrivate: true,
        reason: 'cache-control',
        headers: { cacheControl: 'private' },
      });
      const checker = new PrivacyHeadersChecker(getPrivacyInfo);
      const context = makeContext({
        force: false,
        data: {
          title: 'Confirm Page',
          url: 'https://example.com/confirm',
          content: '',
          headerValue: 'private',
        },
        settings: {
          [StorageKeys.DOMAIN_WHITELIST]: [],
          [StorageKeys.AUTO_SAVE_PRIVACY_BEHAVIOR]: 'confirm',
        } as any,
      });

      const err = await checker.execute(context).catch((e) => e);
      expect(err).toBeInstanceOf(PrivatePageError);
      expect(err.confirmationRequired).toBe(true);
      expect(err.headerValue).toBe('private');
      expect(err.reason).toBe('cache-control');
      expect(pendingStorage.addPendingPage).toHaveBeenCalledWith({
        url: 'https://example.com/confirm',
        title: 'Confirm Page',
        timestamp: T0,
        reason: 'cache-control',
        headerValue: 'private',
        expiry: T0 + 24 * 60 * 60 * 1000,
      });
    });

    it('invalid reason falls through to cache-control (not rejected)', async () => {
      const T0 = 1726876800000;
      vi.useFakeTimers();
      vi.setSystemTime(T0);
      const getPrivacyInfo = vi.fn<() => Promise<any>>().mockResolvedValue({
        isPrivate: true,
        reason: 'weird-reason',
      });
      const checker = new PrivacyHeadersChecker(getPrivacyInfo);
      const context = makeContext({
        force: false,
        data: { title: 'Weird', url: 'https://example.com/weird', content: '' },
        settings: {
          [StorageKeys.DOMAIN_WHITELIST]: [],
          [StorageKeys.AUTO_SAVE_PRIVACY_BEHAVIOR]: 'skip',
        } as any,
      });

      await expect(checker.execute(context)).rejects.toThrow('PRIVATE_PAGE_DETECTED');
      expect(pendingStorage.addPendingPage).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'cache-control' })
      );
    });
  });
});
