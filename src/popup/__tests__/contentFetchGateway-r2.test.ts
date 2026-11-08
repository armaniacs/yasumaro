// @vitest-environment jsdom
/**
 * contentFetchGateway-r2.test.ts
 *
 * PBI 2026-11-08-08 (2): permission / storage failures inside the record-flow
 * ladder must be visible instead of swallowed by empty catches. These tests
 * pin the logging contract: each failing ladder leg still rejects with the
 * generic user-facing error, and the underlying cause is logged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogError = vi.hoisted(() => vi.fn());
const mockIsHostPermitted = vi.hoisted(() => vi.fn());
const mockRequestPermission = vi.hoisted(() => vi.fn());
const mockIsAllUrlsPermitted = vi.hoisted(() => vi.fn());
const mockRequestAllUrls = vi.hoisted(() => vi.fn());

vi.mock('../../utils/logger/types.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logError: mockLogError,
    ErrorCode: {
      PERMISSION_REQUIRED: 'PERM_REQ_001',
      STORAGE_READ_FAILURE: 'STRG_RD_001',
      INTERNAL_ERROR: 'INT_001',
    },
  }),
);
vi.mock('../../utils/logger/core.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logError: mockLogError,
    ErrorCode: {
      PERMISSION_REQUIRED: 'PERM_REQ_001',
      STORAGE_READ_FAILURE: 'STRG_RD_001',
      INTERNAL_ERROR: 'INT_001',
    },
  }),
);
vi.mock('../../utils/logger/api.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logError: mockLogError,
    ErrorCode: {
      PERMISSION_REQUIRED: 'PERM_REQ_001',
      STORAGE_READ_FAILURE: 'STRG_RD_001',
      INTERNAL_ERROR: 'INT_001',
    },
  }),
);

vi.mock('../../utils/permissionManager.js', () => ({
  getPermissionManager: () => ({
    isHostPermitted: mockIsHostPermitted,
    requestPermission: mockRequestPermission,
    isAllUrlsPermitted: mockIsAllUrlsPermitted,
    requestAllUrls: mockRequestAllUrls,
  }),
}));

vi.mock('../../utils/i18n.js', async () => {
  const { mockGetMessage: i18nMock } = await import('../../../testDir/i18nMock.js');
  const getMessage = vi.fn((key: string) => key);
  return i18nMock(getMessage);
});

import { ContentFetchGateway } from '../contentFetchGateway.js';
import { StorageKeys } from '../../utils/storage/types.js';

describe('ContentFetchGateway', () => {
  describe('ladder failure visibility', () => {
    const tab = { id: 1, url: 'https://example.com/page' } as chrome.tabs.Tab;

    beforeEach(() => {
      mockLogError.mockClear();
      mockIsHostPermitted.mockReset().mockResolvedValue(false);
      mockRequestPermission.mockReset().mockResolvedValue(false);
      mockIsAllUrlsPermitted.mockReset().mockResolvedValue(false);
      mockRequestAllUrls.mockReset().mockResolvedValue(false);
      chrome.tabs.sendMessage = vi.fn().mockResolvedValue(null);
      chrome.storage.local.get = vi.fn().mockResolvedValue({});
    });

    it('logs the per-origin permission failure instead of swallowing it', async () => {
      mockIsHostPermitted.mockRejectedValue(new Error('permission check crashed'));

      await expect(new ContentFetchGateway().fetch(tab, false)).rejects.toThrow(
        'errorContentScriptNotAvailable',
      );
      expect(mockLogError).toHaveBeenCalledWith(
        '[contentFetchGateway] Per-origin permission check/request failed',
        expect.objectContaining({ cause: expect.any(Error) }),
        'PERM_REQ_001',
      );
    });

    it('logs the storage failure instead of reading it as opt-out', async () => {
      chrome.storage.local.get = vi.fn().mockRejectedValue(new Error('storage unavailable'));

      await expect(new ContentFetchGateway().fetch(tab, false)).rejects.toThrow(
        'errorContentScriptNotAvailable',
      );
      expect(mockLogError).toHaveBeenCalledWith(
        '[contentFetchGateway] Failed to read the opt-in flag from storage',
        expect.objectContaining({ cause: expect.any(Error) }),
        'STRG_RD_001',
      );
    });

    it('logs the all-urls permission failure instead of swallowing it', async () => {
      chrome.storage.local.get = vi
        .fn()
        .mockResolvedValue({ [StorageKeys.ALLOW_ALL_URLS_OPT_IN]: true });
      mockIsAllUrlsPermitted.mockRejectedValue(new Error('all-urls check crashed'));

      await expect(new ContentFetchGateway().fetch(tab, false)).rejects.toThrow(
        'errorContentScriptNotAvailable',
      );
      expect(mockLogError).toHaveBeenCalledWith(
        '[contentFetchGateway] <all_urls> permission check/request failed',
        expect.objectContaining({ cause: expect.any(Error) }),
        'PERM_REQ_001',
      );
    });
  });
});
