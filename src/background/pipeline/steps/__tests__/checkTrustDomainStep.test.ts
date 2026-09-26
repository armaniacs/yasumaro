/**
 * checkTrustDomainStep のテスト
 *
 * 検証対象:
 * - TRUSTED / SENSITIVE / UNVERIFIED（canProceed=true）での通過
 * - LOCKED（canProceed=false）+ force=false → DOMAIN_NOT_TRUSTED エラー
 * - LOCKED（canProceed=false）+ force=true → 通過
 * - showAlert=true 時の NotificationHelper.notifyError 呼び出し
 * - showAlert=false 時は通知しない
 *
 * canProceed=false を返す trust level は LOCKED だけである
 * （TrustLookup は他の 3 レベルを canProceed=true で返す）。
 * ブロック系の fixture は全て LOCKED を使う。
 */

import { vi } from 'vitest';;
import type { MockedClass } from 'vitest';

vi.mock('../../../../utils/logger/types.js', () => ({
  addLog: vi.fn(),
  logError: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
  ErrorCode: { INTERNAL_ERROR: 'INT_001', UNKNOWN_ERROR: 'UNKN_001' },
}));
vi.mock('../../../../utils/logger/core.js', () => ({
  addLog: vi.fn(),
  logError: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
  ErrorCode: { INTERNAL_ERROR: 'INT_001', UNKNOWN_ERROR: 'UNKN_001' },
}));
vi.mock('../../../../utils/logger/api.js', () => ({
  addLog: vi.fn(),
  logError: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
  ErrorCode: { INTERNAL_ERROR: 'INT_001', UNKNOWN_ERROR: 'UNKN_001' },
}));
vi.mock('../../../../utils/trustChecker.js', () => ({
  TrustChecker: vi.fn(),
}));
vi.mock('../../../notificationHelper.js', () => ({
  NotificationHelper: { notifyError: vi.fn() },
}));

import { checkTrustDomainStep } from '../checkTrustDomainStep.js';
import { TrustChecker } from '../../../../utils/trustChecker.js';
import { NotificationHelper } from '../../../notificationHelper.js';
import type { RecordingContext } from '../../types.js';

const MockedTrustChecker = TrustChecker as MockedClass<typeof TrustChecker>;

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
  reason?: string | undefined;
  trustResult: { level: string; source: string };
}) {
  const mockCheckDomain = vi.fn<() => Promise<any>>().mockResolvedValue(mockResult);
  // Use function() instead of arrow function because TrustChecker is instantiated with 'new'
  MockedTrustChecker.mockImplementation(function(this: any) {
    this.checkDomain = mockCheckDomain;
    this.loadAlertSettings = vi.fn();
  });
  return mockCheckDomain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkTrustDomainStep', () => {
  describe('信頼ドメイン', () => {
    it('sets trustCheck and passes when canProceed=true', async () => {
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

  describe('UNVERIFIED / SENSITIVE（記録される）', () => {
    it('records an UNVERIFIED domain because only LOCKED blocks recording', async () => {
      setupTrustChecker({
        canProceed: true,
        showAlert: false,
        trustResult: { level: 'unverified', source: 'none' },
      });

      const result = await checkTrustDomainStep(makeContext({ force: false }));

      expect(result.trustCheck).toEqual({
        canProceed: true,
        showAlert: false,
        reason: undefined,
        trustLevel: 'unverified',
      });
    });

    it('records a SENSITIVE domain and carries the alert flag without a block notification', async () => {
      setupTrustChecker({
        canProceed: true,
        showAlert: true,
        reason: 'Financial site',
        trustResult: { level: 'sensitive', source: 'tranco' },
      });

      const result = await checkTrustDomainStep(makeContext({ force: false }));

      expect(result.trustCheck).toEqual({
        canProceed: true,
        showAlert: true,
        reason: 'Financial site',
        trustLevel: 'sensitive',
      });
      // この step の通知は記録ブロック時だけ。警告は Trust バッジ側で描画される
      expect(NotificationHelper.notifyError).not.toHaveBeenCalled();
    });
  });

  describe('LOCKED ドメイン + force=false', () => {
    it('throws DOMAIN_NOT_TRUSTED when canProceed=false and force=false', async () => {
      setupTrustChecker({
        canProceed: false,
        showAlert: false,
        reason: 'Blocked domain',
        trustResult: { level: 'locked', source: 'manual' },
      });

      const context = makeContext({ force: false });
      await expect(checkTrustDomainStep(context)).rejects.toThrow('DOMAIN_NOT_TRUSTED');
    });

    it('calls NotificationHelper.notifyError when showAlert=true', async () => {
      setupTrustChecker({
        canProceed: false,
        showAlert: true,
        reason: 'Blocked domain',
        trustResult: { level: 'locked', source: 'manual' },
      });

      const context = makeContext({ force: false });
      try {
        await checkTrustDomainStep(context);
      } catch {
        // expected
      }

      expect(NotificationHelper.notifyError).toHaveBeenCalledWith(
        expect.stringContaining('Blocked domain')
      );
    });

    it('does not call NotificationHelper.notifyError when showAlert=false', async () => {
      setupTrustChecker({
        canProceed: false,
        showAlert: false,
        reason: 'Blocked domain',
        trustResult: { level: 'locked', source: 'manual' },
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

  describe('LOCKED ドメイン + force=true', () => {
    it('passes when force=true even if canProceed=false', async () => {
      setupTrustChecker({
        canProceed: false,
        showAlert: true,
        reason: 'Blocked domain',
        trustResult: { level: 'locked', source: 'manual' },
      });

      const context = makeContext({ force: true });
      const result = await checkTrustDomainStep(context);

      expect(result.trustCheck).toBeDefined();
      expect(result.trustCheck?.canProceed).toBe(false);
    });

    it('emits no notification even when force=true', async () => {
      setupTrustChecker({
        canProceed: false,
        showAlert: true,
        reason: 'Blocked domain',
        trustResult: { level: 'locked', source: 'manual' },
      });

      const context = makeContext({ force: true });
      await checkTrustDomainStep(context);

      expect(NotificationHelper.notifyError).not.toHaveBeenCalled();
    });
  });

  describe('reason 未設定時', () => {
    it('uses a fallback error message even when reason is undefined', async () => {
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
