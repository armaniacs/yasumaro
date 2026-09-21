/**
 * recordingDecisionConflict — PBI 2026-09-19-08 組み合わせテスト
 *
 * Current-behavior pin: 判定順序 truncate -> domainFilter -> permission -> trust
 * -> privacyHeaders -> duplicate において、競合時の勝者が一意に決まることを
 * EXISTING step 関数 against に固定する。pure-function 抽出の前後で
 * byte-equal behavior を保証するための先行テスト（変更前の振る舞い固定）。
 *
 * NOTE: このファイルは抽出後に変更しない。pure seam の単体テストは
 * recordingDecision.test.ts に分離する。
 */

import { vi } from 'vitest';;
import type { MockedFunction, MockedClass } from 'vitest';

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
vi.mock('../../../../utils/domainUtils.js', () => ({
  isDomainAllowed: vi.fn(),
  extractDomain: vi.fn(),
}));
vi.mock('../../../../utils/permissionManager.js');
vi.mock('../../../../utils/trustChecker.js', () => ({
  TrustChecker: vi.fn(),
}));
vi.mock('../../../notificationHelper.js', () => ({
  NotificationHelper: { notifyError: vi.fn() },
}));
vi.mock('../../../../utils/storage/types.js');
vi.mock('../../../../utils/storage/defaults.js');
vi.mock('../../../../utils/storage/encryptionSession.js');
vi.mock('../../../../utils/storage/savedUrlRepository.js');
vi.mock('../../../../utils/storage/domainFilterCache.js');
vi.mock('../../../../utils/storage/quota.js');
vi.mock('../../../../utils/pendingStorage.js');

import { checkDomainFilterStep } from '../checkDomainFilterStep.js';
import { checkPermissionStep } from '../checkPermissionStep.js';
import { checkTrustDomainStep } from '../checkTrustDomainStep.js';
import { PrivacyHeadersChecker } from '../checkPrivacyHeadersStep.js';
import * as domainUtils from '../../../../utils/domainUtils.js';
import * as permissionManager from '../../../../utils/permissionManager.js';
import { TrustChecker } from '../../../../utils/trustChecker.js';
import { StorageKeys } from '../../../../utils/storage/types.js';
import type { RecordingContext } from '../../types.js';

const mockIsDomainAllowed = domainUtils.isDomainAllowed as MockedFunction<typeof domainUtils.isDomainAllowed>;
const mockExtractDomain = domainUtils.extractDomain as MockedFunction<typeof domainUtils.extractDomain>;
const MockedTrustChecker = TrustChecker as MockedClass<typeof TrustChecker>;

function makeContext(overrides: Partial<RecordingContext> = {}): RecordingContext {
  return {
    data: { title: 'T', url: 'https://example.com/page', content: 'x' },
    settings: {
      [StorageKeys.DOMAIN_WHITELIST]: [],
      [StorageKeys.AUTO_SAVE_PRIVACY_BEHAVIOR]: 'skip',
    } as any,
    force: false,
    errors: [],
    ...overrides,
  };
}

function setupAllDeny() {
  mockIsDomainAllowed.mockResolvedValue(false);
  mockExtractDomain.mockReturnValue('example.com');
  // @ts-expect-error - mock
  (permissionManager.getPermissionManager as any).mockReturnValue({
    isHostPermitted: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
    recordDeniedVisit: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  });
  MockedTrustChecker.mockImplementation(function (this: any) {
    this.checkDomain = vi.fn<() => Promise<any>>().mockResolvedValue({
      canProceed: false,
      showAlert: false,
      reason: 'Unverified domain',
      trustResult: { level: 'unverified', source: 'none' },
    });
    this.loadAlertSettings = vi.fn();
  });
}

function makePrivacyCheckerDenied() {
  const getPrivacyInfo = vi.fn<() => Promise<any>>().mockResolvedValue({
    isPrivate: true,
    reason: 'cache-control',
    headers: { cacheControl: 'private, no-store' },
  });
  return new PrivacyHeadersChecker(getPrivacyInfo);
}

/** Run the 4 admission gates in orchestrator order; return first rejection error message. */
async function firstRejection(ctx: RecordingContext): Promise<string | null> {
  try {
    await checkDomainFilterStep(ctx);
  } catch (e) {
    return (e as Error).message;
  }
  try {
    await checkPermissionStep(ctx);
  } catch (e) {
    return (e as Error).message;
  }
  try {
    await checkTrustDomainStep(ctx);
  } catch (e) {
    return (e as Error).message;
  }
  try {
    await makePrivacyCheckerDenied().execute(ctx);
  } catch (e) {
    return (e as Error).message;
  }
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('recording decision conflict matrix (behavior pin)', () => {
  it('all gates deny -> domainFilter wins (DOMAIN_BLOCKED)', async () => {
    setupAllDeny();
    expect(await firstRejection(makeContext())).toBe('DOMAIN_BLOCKED');
  });

  it('domain allows, rest deny -> permission wins (PERMISSION_REQUIRED)', async () => {
    setupAllDeny();
    mockIsDomainAllowed.mockResolvedValue(true);
    expect(await firstRejection(makeContext())).toBe('PERMISSION_REQUIRED');
  });

  it('domain+permission allow, rest deny -> trust wins (DOMAIN_NOT_TRUSTED)', async () => {
    setupAllDeny();
    mockIsDomainAllowed.mockResolvedValue(true);
    // @ts-expect-error - mock
    (permissionManager.getPermissionManager as any).mockReturnValue({
      isHostPermitted: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
      recordDeniedVisit: vi.fn(),
    });
    expect(await firstRejection(makeContext())).toBe('DOMAIN_NOT_TRUSTED');
  });

  it('domain+permission+trust allow, privacy denies -> privacy wins (PRIVATE_PAGE_DETECTED)', async () => {
    setupAllDeny();
    mockIsDomainAllowed.mockResolvedValue(true);
    // @ts-expect-error - mock
    (permissionManager.getPermissionManager as any).mockReturnValue({
      isHostPermitted: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
      recordDeniedVisit: vi.fn(),
    });
    MockedTrustChecker.mockImplementation(function (this: any) {
      this.checkDomain = vi.fn<() => Promise<any>>().mockResolvedValue({
        canProceed: true,
        showAlert: false,
        trustResult: { level: 'trusted', source: 'jp-anchor' },
      });
      this.loadAlertSettings = vi.fn();
    });
    expect(await firstRejection(makeContext())).toBe('PRIVATE_PAGE_DETECTED');
  });

  it('all gates allow -> no rejection (null)', async () => {
    mockIsDomainAllowed.mockResolvedValue(true);
    mockExtractDomain.mockReturnValue('example.com');
    // @ts-expect-error - mock
    (permissionManager.getPermissionManager as any).mockReturnValue({
      isHostPermitted: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
      recordDeniedVisit: vi.fn(),
    });
    MockedTrustChecker.mockImplementation(function (this: any) {
      this.checkDomain = vi.fn<() => Promise<any>>().mockResolvedValue({
        canProceed: true,
        showAlert: false,
        trustResult: { level: 'trusted', source: 'jp-anchor' },
      });
      this.loadAlertSettings = vi.fn();
    });
    const getPrivacyInfo = vi.fn<() => Promise<any>>().mockResolvedValue({ isPrivate: false });
    const checker = new PrivacyHeadersChecker(getPrivacyInfo);
    const ctx = makeContext();
    await expect(checkDomainFilterStep(ctx)).resolves.toBeDefined();
    await expect(checkPermissionStep(ctx)).resolves.toBeDefined();
    await expect(checkTrustDomainStep(ctx)).resolves.toBeDefined();
    await expect(checker.execute(ctx)).resolves.toBe(ctx);
  });

  it('force=true bypasses domain+trust+privacy but NOT permission (current behavior pin)', async () => {
    setupAllDeny();
    const ctx = makeContext({ force: true });
    // domain + trust + privacy pass under force
    await expect(checkDomainFilterStep(ctx)).resolves.toBeDefined();
    await expect(checkTrustDomainStep(ctx)).resolves.toBeDefined();
    await expect(makePrivacyCheckerDenied().execute(ctx)).resolves.toBe(ctx);
    // permission has no force bypass -> still rejects
    await expect(checkPermissionStep(ctx)).rejects.toThrow('PERMISSION_REQUIRED');
  });

  it('single-gate verdicts: each gate rejects alone with its own code', async () => {
    // domain alone
    mockIsDomainAllowed.mockResolvedValue(false);
    await expect(checkDomainFilterStep(makeContext())).rejects.toThrow('DOMAIN_BLOCKED');

    // permission alone
    mockExtractDomain.mockReturnValue('example.com');
    // @ts-expect-error - mock
    (permissionManager.getPermissionManager as any).mockReturnValue({
      isHostPermitted: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
      recordDeniedVisit: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    });
    await expect(checkPermissionStep(makeContext())).rejects.toThrow('PERMISSION_REQUIRED');

    // trust alone
    MockedTrustChecker.mockImplementation(function (this: any) {
      this.checkDomain = vi.fn<() => Promise<any>>().mockResolvedValue({
        canProceed: false,
        showAlert: false,
        reason: 'Unverified domain',
        trustResult: { level: 'unverified', source: 'none' },
      });
      this.loadAlertSettings = vi.fn();
    });
    await expect(checkTrustDomainStep(makeContext())).rejects.toThrow('DOMAIN_NOT_TRUSTED');

    // privacy alone
    await expect(makePrivacyCheckerDenied().execute(makeContext())).rejects.toThrow(
      'PRIVATE_PAGE_DETECTED'
    );
  });

  it('privacy allow variants: save-behavior and non-private pass through', async () => {
    const saveCtx = makeContext({
      settings: {
        [StorageKeys.DOMAIN_WHITELIST]: [],
        [StorageKeys.AUTO_SAVE_PRIVACY_BEHAVIOR]: 'save',
      } as any,
    });
    const saver = new PrivacyHeadersChecker(
      vi.fn<() => Promise<any>>().mockResolvedValue({
        isPrivate: true,
        reason: 'cache-control',
        headers: { cacheControl: 'private' },
      })
    );
    await expect(saver.execute(saveCtx)).resolves.toBe(saveCtx);

    const clean = new PrivacyHeadersChecker(
      vi.fn<() => Promise<any>>().mockResolvedValue({ isPrivate: false })
    );
    const cleanCtx = makeContext();
    await expect(clean.execute(cleanCtx)).resolves.toBe(cleanCtx);
  });
});
