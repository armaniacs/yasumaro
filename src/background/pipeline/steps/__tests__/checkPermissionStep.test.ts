/**
 * checkPermissionStep のテスト
 *
 * 検証対象:
 * - パーミッション許可時は permissionCheck.result が設定される
 * - パーミッション拒否時は PERMISSION_REQUIRED エラー + recordDeniedVisit 呼び出し
 * - 不正 URL 時の INVALID_URL エラー
 * - extractDomain フォールバック（www 除去）
 */

import { jest } from '@jest/globals';

jest.mock('../../../../utils/logger.js', () => ({
  addLog: jest.fn(),
  logError: jest.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
  ErrorCode: { INTERNAL_ERROR: 'INT_001', UNKNOWN_ERROR: 'UNKN_001' },
}));
jest.mock('../../../../utils/domainUtils.js', () => ({
  extractDomain: jest.fn(),
}));
jest.mock('../../../../utils/permissionManager.js');

import { checkPermissionStep } from '../checkPermissionStep.js';
import * as domainUtils from '../../../../utils/domainUtils.js';
import * as permissionManager from '../../../../utils/permissionManager.js';
import type { RecordingContext } from '../../types.js';

const mockExtractDomain = domainUtils.extractDomain as jest.MockedFunction<typeof domainUtils.extractDomain>;

function makeContext(overrides: Partial<RecordingContext> = {}): RecordingContext {
  return {
    data: {
      title: 'Test Page',
      url: 'https://example.com/page',
      content: 'Some content',
    },
    settings: {} as any,
    force: false,
    errors: [],
    ...overrides,
  };
}

function setupMocks({ permitted = true, domain = 'example.com' } = {}) {
  const mockIsHostPermitted = jest.fn<() => Promise<boolean>>().mockResolvedValue(permitted);
  const mockRecordDeniedVisit = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

  // @ts-expect-error - mock
  permissionManager.getPermissionManager.mockReturnValue({
    isHostPermitted: mockIsHostPermitted,
    recordDeniedVisit: mockRecordDeniedVisit,
  });

  mockExtractDomain.mockReturnValue(domain);

  return { mockIsHostPermitted, mockRecordDeniedVisit };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('checkPermissionStep', () => {
  describe('パーミッション許可', () => {
    it('isHostPermitted=true の場合 permissionCheck.permitted=true を返す', async () => {
      setupMocks({ permitted: true, domain: 'example.com' });

      const context = makeContext();
      const result = await checkPermissionStep(context);

      expect(result.permissionCheck).toEqual({
        permitted: true,
        domain: 'example.com',
      });
    });

    it('ドメインが extractDomain で取得される', async () => {
      const { mockIsHostPermitted } = setupMocks({ permitted: true, domain: 'test.org' });
      mockExtractDomain.mockReturnValue('test.org');

      const context = makeContext({
        data: { title: 'Test', url: 'https://www.test.org/path', content: '' },
      });
      const result = await checkPermissionStep(context);

      expect(result.permissionCheck?.domain).toBe('test.org');
      expect(mockExtractDomain).toHaveBeenCalledWith('https://www.test.org/path');
    });
  });

  describe('パーミッション拒否', () => {
    it('isHostPermitted=false の場合 PERMISSION_REQUIRED を throw する', async () => {
      setupMocks({ permitted: false });

      const context = makeContext();
      await expect(checkPermissionStep(context)).rejects.toThrow('PERMISSION_REQUIRED');
    });

    it('拒否時に recordDeniedVisit が呼ばれる', async () => {
      const { mockRecordDeniedVisit } = setupMocks({ permitted: false, domain: 'example.com' });

      const context = makeContext();
      try {
        await checkPermissionStep(context);
      } catch {
        // expected
      }

      expect(mockRecordDeniedVisit).toHaveBeenCalledWith('example.com');
    });
  });

  describe('不正 URL', () => {
    it('extractDomain が null かつ new URL でもパースできない場合 INVALID_URL を throw する', async () => {
      const mockIsHostPermitted = jest.fn<() => Promise<boolean>>().mockResolvedValue(false);
      const mockRecordDeniedVisit = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

      // @ts-expect-error - mock
      permissionManager.getPermissionManager.mockReturnValue({
        isHostPermitted: mockIsHostPermitted,
        recordDeniedVisit: mockRecordDeniedVisit,
      });

      // extractDomain は null を返し、new URL も例外を投げる不正 URL
      mockExtractDomain.mockReturnValue(null);

      const context = makeContext({
        data: { title: 'Test', url: 'not-a-valid-url', content: '' },
      });

      await expect(checkPermissionStep(context)).rejects.toThrow('INVALID_URL');
    });
  });

  describe('extractDomain フォールバック', () => {
    it('extractDomain が null を返した場合 new URL でフォールバックする', async () => {
      const mockIsHostPermitted = jest.fn<() => Promise<boolean>>().mockResolvedValue(true);

      // @ts-expect-error - mock
      permissionManager.getPermissionManager.mockReturnValue({
        isHostPermitted: mockIsHostPermitted,
        recordDeniedVisit: jest.fn(),
      });

      mockExtractDomain.mockReturnValue(null);

      const context = makeContext({
        data: { title: 'Test', url: 'https://fallback.example.com/page', content: '' },
      });

      const result = await checkPermissionStep(context);

      expect(result.permissionCheck?.domain).toBe('fallback.example.com');
    });
  });
});
