/**
 * checkPrivacyHeadersStep (PrivacyHeadersChecker) のテスト
 *
 * 修正された問題:
 *   force=true の場合でも AUTO_SAVE_PRIVACY_BEHAVIOR='skip'/'confirm' の設定で
 *   PRIVATE_PAGE_DETECTED エラーが throw されていた。
 *   ユーザーが「それでも記録」を選択した際に記録できない問題を修正済み。
 */

import { vi } from 'vitest';;

vi.mock('../../../../utils/logger.js');
vi.mock('../../../../utils/storage.js');
vi.mock('../../../../utils/pendingStorage.js');

import { PrivacyHeadersChecker } from '../checkPrivacyHeadersStep.js';
import { StorageKeys } from '../../../../utils/storage.js';
import * as pendingStorage from '../../../../utils/pendingStorage.js';
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
    it('AUTO_SAVE_PRIVACY_BEHAVIOR=skip でもプライバシーチェックをスキップして記録を許可する', async () => {
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

    it('AUTO_SAVE_PRIVACY_BEHAVIOR=confirm でもプライバシーチェックをスキップして記録を許可する', async () => {
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

    it('force=true かつ isPrivate=false の場合も正常に通過する', async () => {
      const getPrivacyInfo = vi.fn<() => Promise<any>>().mockResolvedValue({
        isPrivate: false,
      });
      const checker = new PrivacyHeadersChecker(getPrivacyInfo);

      const context = makeContext({ force: true });

      await expect(checker.execute(context)).resolves.toBe(context);
    });
  });

  describe('force=false の場合', () => {
    it('AUTO_SAVE_PRIVACY_BEHAVIOR=skip で PRIVATE_PAGE_DETECTED を throw する', async () => {
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

    it('AUTO_SAVE_PRIVACY_BEHAVIOR=save で正常に通過する', async () => {
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

    it('isPrivate=false の場合は正常に通過する', async () => {
      const getPrivacyInfo = vi.fn<() => Promise<any>>().mockResolvedValue({
        isPrivate: false,
      });
      const checker = new PrivacyHeadersChecker(getPrivacyInfo);

      const context = makeContext({ force: false });

      await expect(checker.execute(context)).resolves.toBe(context);
    });
  });

  describe('ホワイトリスト', () => {
    it('ホワイトリストに含まれるドメインはプライバシーチェックをスキップする', async () => {
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
  });

  describe('headerValue のマスク処理', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      // @ts-expect-error - vi.fn() type narrowing
      (pendingStorage.addPendingPage as vi.Mock).mockResolvedValue(undefined);
    });

    it('authorization reason の場合は headerValue が [REDACTED] で保存される', async () => {
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

    it('cache-control reason の場合は headerValue がそのまま保存される', async () => {
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

    it('requireConfirmation=true + authorization の場合も [REDACTED] で保存される', async () => {
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
});
