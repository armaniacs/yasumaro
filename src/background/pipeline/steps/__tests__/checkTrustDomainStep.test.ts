/**
 * checkTrustDomainStep のテスト
 *
 * 検証対象:
 * - 信頼ドメイン通過（trustCheck.result 設定）
 * - 未信頼ドメイン + force=false → DOMAIN_NOT_TRUSTED エラー
 * - 未信頼ドメイン + force=true → 通過
 * - showAlert=true 時の NotificationHelper.notifyError 呼び出し
 * - showAlert=false 時は通知しない
 */

import { jest } from '@jest/globals';

jest.mock('../../../../utils/logger.js', () => ({
  addLog: jest.fn(),
  logError: jest.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
  ErrorCode: { INTERNAL_ERROR: 'INT_001', UNKNOWN_ERROR: 'UNKN_001' },
}));
jest.mock('../../../../utils/trustChecker.js', () => ({
  TrustChecker: jest.fn(),
}));
jest.mock('../../../notificationHelper.js', () => ({
  NotificationHelper: { notifyError: jest.fn() },
}));

import { checkTrustDomainStep } from '../checkTrustDomainStep.js';
import { TrustChecker } from '../../../../utils/trustChecker.js';
import { NotificationHelper } from '../../../notificationHelper.js';
import type { RecordingContext } from '../../types.js';

const MockedTrustChecker = TrustChecker as jest.MockedClass<typeof TrustChecker>;

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

function setupTrustChecker(mockResult: {
  canProceed: boolean;
  showAlert: boolean;
  reason?: string;
  trustResult: { level: string; source: string };
}) {
  const mockCheckDomain = jest.fn<() => Promise<any>>().mockResolvedValue(mockResult);
  MockedTrustChecker.mockImplementation(() => ({
    checkDomain: mockCheckDomain,
    loadAlertSettings: jest.fn(),
  }) as any);
  return mockCheckDomain;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('checkTrustDomainStep', () => {
  describe('信頼ドメイン', () => {
    it('canProceed=true の場合 trustCheck を設定して通過する', async () => {
      setupTrustChecker({
        canProceed: true,
        showAlert: false,
        trustResult: { level: 'trusted', source: 'jp-anchor' },
      });

      const context = makeContext();
      const result = await checkTrustDomainStep(context);

      expect(result.trustCheck).toEqual({
        canProceed: true,
        showAlert: false,
        reason: undefined,
        trustLevel: 'trusted',
      });
    });
  });

  describe('未信頼ドメイン + force=false', () => {
    it('canProceed=false かつ force=false の場合 DOMAIN_NOT_TRUSTED を throw する', async () => {
      setupTrustChecker({
        canProceed: false,
        showAlert: false,
        reason: 'Unverified domain',
        trustResult: { level: 'unverified', source: 'none' },
      });

      const context = makeContext({ force: false });
      await expect(checkTrustDomainStep(context)).rejects.toThrow('DOMAIN_NOT_TRUSTED');
    });

    it('showAlert=true の場合 NotificationHelper.notifyError が呼ばれる', async () => {
      setupTrustChecker({
        canProceed: false,
        showAlert: true,
        reason: 'Financial site',
        trustResult: { level: 'sensitive', source: 'tranco' },
      });

      const context = makeContext({ force: false });
      try {
        await checkTrustDomainStep(context);
      } catch {
        // expected
      }

      expect(NotificationHelper.notifyError).toHaveBeenCalledWith(
        expect.stringContaining('Financial site')
      );
    });

    it('showAlert=false の場合 NotificationHelper.notifyError は呼ばれない', async () => {
      setupTrustChecker({
        canProceed: false,
        showAlert: false,
        reason: 'Unverified domain',
        trustResult: { level: 'unverified', source: 'none' },
      });

      const context = makeContext({ force: false });
      try {
        await checkTrustDomainStep(context);
      } catch {
        // expected
      }

      expect(NotificationHelper.notifyError).not.toHaveBeenCalled();
    });
  });

  describe('未信頼ドメイン + force=true', () => {
    it('canProceed=false でも force=true なら通過する', async () => {
      setupTrustChecker({
        canProceed: false,
        showAlert: true,
        reason: 'Financial site',
        trustResult: { level: 'sensitive', source: 'tranco' },
      });

      const context = makeContext({ force: true });
      const result = await checkTrustDomainStep(context);

      expect(result.trustCheck).toBeDefined();
      expect(result.trustCheck?.canProceed).toBe(false);
    });

    it('force=true でも通知は発生しない', async () => {
      setupTrustChecker({
        canProceed: false,
        showAlert: true,
        reason: 'Financial site',
        trustResult: { level: 'sensitive', source: 'tranco' },
      });

      const context = makeContext({ force: true });
      await checkTrustDomainStep(context);

      expect(NotificationHelper.notifyError).not.toHaveBeenCalled();
    });
  });

  describe('reason 未設定時', () => {
    it('reason が undefined の場合でもエラーメッセージにフォールバックが使われる', async () => {
      setupTrustChecker({
        canProceed: false,
        showAlert: true,
        reason: undefined,
        trustResult: { level: 'locked', source: 'manual' },
      });

      const context = makeContext({ force: false });
      try {
        await checkTrustDomainStep(context);
      } catch {
        // expected
      }

      expect(NotificationHelper.notifyError).toHaveBeenCalledWith(
        expect.stringContaining('Domain not trusted for recording')
      );
    });
  });
});
