// @vitest-environment jsdom
/**
 * Parity tests for the trustPanel split (pbi/2026-10-03-25): the trust /
 * permission flow and the all-URLs banner moved out of statusPanel.ts into
 * popup/trustPanel.ts. Each scenario mirrors a flow the pre-split suite
 * pinned against statusPanel.js — now executed against trustPanel.js
 * directly — plus the wiring that keeps statusPanel's exports pointed at the
 * same implementation (main.ts / recordSession.ts / the existing suite all
 * import through statusPanel.js).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drainMacrotask, useTimerClock, waitForMock } from '../../../testDir/waitPolicy.js';

// chrome.runtime.lastError is readonly in @types/chrome; tests need to simulate it.
type MutableLastError = { lastError: chrome.runtime.LastError | null };

const {
  mockGetCurrentTab,
  mockGetMessage,
  mockIsAllUrlsPermitted,
  mockRequestAllUrls,
  mockIsHostPermitted,
  mockRecordDeniedVisit,
  mockRequestPermission,
  mockGetTrustLevelDisplay,
  mockCheckDomainTrust,
  mockLogError,
} = vi.hoisted(() => ({
  mockGetCurrentTab: vi.fn(),
  mockGetMessage: vi.fn(),
  mockIsAllUrlsPermitted: vi.fn(),
  mockRequestAllUrls: vi.fn(),
  mockIsHostPermitted: vi.fn(),
  mockRecordDeniedVisit: vi.fn(),
  mockRequestPermission: vi.fn(),
  mockGetTrustLevelDisplay: vi.fn(),
  mockCheckDomainTrust: vi.fn(),
  mockLogError: vi.fn(),
}));

// PBI 2026-09-23-14 seam discipline: only the query root is faked; the
// narrow adapters stay wired to it so the banner's post-grant read flows
// through the single mocked root, same as the pre-split suite.
vi.mock('../tabUtils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tabUtils.js')>();
  return {
    ...actual,
    getCurrentTab: mockGetCurrentTab,
    getActiveTabUrl: async () => (await mockGetCurrentTab())?.url ?? null,
  };
});

vi.mock('../../utils/i18n.js', async () => {
  const { mockGetMessage: i18nMock } = await import('../../../testDir/i18nMock.js');
  return i18nMock(mockGetMessage);
});

vi.mock('../../utils/permissionManager.js', () => ({
  isAllUrlsPermitted: mockIsAllUrlsPermitted,
  requestAllUrls: mockRequestAllUrls,
  isHostPermitted: mockIsHostPermitted,
  recordDeniedVisit: mockRecordDeniedVisit,
  requestPermission: mockRequestPermission,
}));

vi.mock('../../utils/trustChecker.js', () => ({
  getTrustLevelDisplay: mockGetTrustLevelDisplay,
  checkDomainTrust: mockCheckDomainTrust,
}));

vi.mock('../../utils/logger/types.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logError: mockLogError,
    ErrorCode: { INTERNAL_ERROR: 'INT_001' },
  }),
);
vi.mock('../../utils/logger/core.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logError: mockLogError,
    ErrorCode: { INTERNAL_ERROR: 'INT_001' },
  }),
);
vi.mock('../../utils/logger/api.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logError: mockLogError,
    ErrorCode: { INTERNAL_ERROR: 'INT_001' },
  }),
);

import {
  updateTrustStatus,
  initAllUrlsPermissionBanner,
  reportHandlerError,
} from '../trustPanel.js';
import {
  updateTrustStatus as statusPanelUpdateTrustStatus,
  initAllUrlsPermissionBanner as statusPanelInitAllUrlsPermissionBanner,
} from '../statusPanel.js';

const defaultMessages: Record<string, string> = {
  statusTrustLocked: 'LOCKED',
  statusTrustTrusted: 'Trusted',
  statusTrustSensitive: 'Sensitive',
  statusTrustUnverified: 'Unverified',
  statusTrustAlertFinance: 'Finance site',
  statusTrustAlertSensitive: 'Sensitive site',
  statusNoInfo: 'No info',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetMessage.mockImplementation((key: string) => defaultMessages[key] || key);
});

afterEach(async () => {
  vi.useRealTimers();
});

describe('trustPanel wiring — statusPanel exports stay pointed at trustPanel', () => {
  it('re-exports the same implementation the module owns (main.ts / recordSession.ts import through statusPanel.js)', () => {
    expect(statusPanelUpdateTrustStatus).toBe(updateTrustStatus);
    expect(statusPanelInitAllUrlsPermissionBanner).toBe(initAllUrlsPermissionBanner);
  });

  it('keeps the dynamic imports the flows rely on (same paths, same timing)', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const trustSource = readFileSync(join(dir, '..', 'trustPanel.ts'), 'utf-8');
    expect(trustSource).toMatch(/await import\('\.\.\/utils\/permissionManager\.js'\)/);
    expect(trustSource).toMatch(/await import\('\.\.\/utils\/trustChecker\.js'\)/);
    expect(trustSource).not.toMatch(/from '\.\.\/utils\/permissionManager\.js'/);
    expect(trustSource).not.toMatch(/from '\.\.\/utils\/trustChecker\.js'/);
  });
});

describe('updateTrustStatus — trust/permission flow parity', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="statusTrustContent"></div>
      <div id="permissionRequestArea" class="hidden">
        <button id="btnRequestPermission"></button>
      </div>
      <button id="recordBtn"></button>
      <div id="permissionDeniedMessage" class="hidden"></div>
    `;
    mockIsAllUrlsPermitted.mockResolvedValue(true);
    mockIsHostPermitted.mockResolvedValue(true);
  });

  it('resolves without throwing when trustContent is missing', async () => {
    document.body.innerHTML = '';
    await expect(updateTrustStatus('https://example.com')).resolves.not.toThrow();
  });

  it('renders LOCKED + permission area on denial and leaves recordBtn to RecordSession', async () => {
    mockIsAllUrlsPermitted.mockResolvedValue(false);
    mockIsHostPermitted.mockResolvedValue(false);
    const recordBtn = document.getElementById('recordBtn') as HTMLButtonElement;
    recordBtn.disabled = false;
    await updateTrustStatus('https://example.com');
    const trustContent = document.getElementById('statusTrustContent')!;
    expect(trustContent.innerHTML).toContain('LOCKED');
    expect(trustContent.innerHTML).toContain('status-trust-locked');
    expect(document.getElementById('permissionRequestArea')!.classList.contains('hidden')).toBe(false);
    expect(recordBtn.disabled).toBe(false);
  });

  it('grants via the wired request button: prompt → area hidden → trust level re-rendered', async () => {
    // The queue decides which check sees what: the initial call is denied
    // (LOCKED render), the recursive post-grant refresh sees the grant.
    mockIsAllUrlsPermitted.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mockIsHostPermitted.mockResolvedValue(false);
    mockRequestPermission.mockResolvedValue(true);
    mockGetTrustLevelDisplay.mockResolvedValue({ level: 'Trusted' });
    mockCheckDomainTrust.mockResolvedValue({ showAlert: false, trustResult: {} });
    await updateTrustStatus('https://example.com');
    expect(mockIsAllUrlsPermitted).toHaveBeenCalledTimes(1);

    const requestBtn = document.getElementById('btnRequestPermission')!;
    requestBtn.click();
    // The click chain ends in a fire-and-forget refresh that re-enters the
    // flow through the same mocked seam and renders the trust level.
    await waitForMock(() => {
      expect(mockRequestPermission).toHaveBeenCalledWith('https://example.com');
    });
    await waitForMock(() => {
      expect(document.getElementById('permissionRequestArea')!.classList.contains('hidden')).toBe(true);
    });
    await waitForMock(() => {
      expect(document.getElementById('statusTrustContent')!.innerHTML).toContain('status-trust-trusted');
    });
  });

  it('records the denied visit and runs the double-deny toast chain on denial', async () => {
    useTimerClock();
    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => { cb(0); return 0 as any; });
    mockIsAllUrlsPermitted.mockResolvedValue(false);
    mockIsHostPermitted.mockResolvedValue(false);
    mockRequestPermission.mockResolvedValue(false);
    await updateTrustStatus('https://example.com');

    const requestBtn = document.getElementById('btnRequestPermission') as HTMLButtonElement;
    requestBtn.click();
    // +0ms flushes the click chain's microtasks without advancing the clock,
    // so the toast is still mid-transition when the visible state is pinned.
    await vi.advanceTimersByTimeAsync(0);
    expect(mockRecordDeniedVisit).toHaveBeenCalledWith('example.com');
    const errorMsg = document.getElementById('permissionDeniedMessage')!;
    expect(errorMsg.classList.contains('hidden')).toBe(false);
    expect(errorMsg.classList.contains('visible')).toBe(true);
    // 3000ms hide-visible + 300ms add-hidden — the double-deny chain.
    await vi.advanceTimersByTimeAsync(3300);
    expect(errorMsg.classList.contains('hidden')).toBe(true);
    expect(errorMsg.classList.contains('visible')).toBe(false);
    rafSpy.mockRestore();
  });

  it('renders the trust level for permitted URLs', async () => {
    mockGetTrustLevelDisplay.mockResolvedValue({ level: 'Sensitive' });
    mockCheckDomainTrust.mockResolvedValue({ showAlert: true, trustResult: { category: 'finance' } });
    await updateTrustStatus('https://example.com');
    const trustContent = document.getElementById('statusTrustContent')!;
    expect(trustContent.innerHTML).toContain('Sensitive');
    expect(trustContent.innerHTML).toContain('status-trust-sensitive');
    expect(trustContent.innerHTML).toContain('Finance site');
    expect(document.getElementById('permissionRequestArea')!.classList.contains('hidden')).toBe(true);
  });

  it('falls back to muted "No info" when the trust check rejects', async () => {
    mockGetTrustLevelDisplay.mockRejectedValue(new Error('trust check failed'));
    await updateTrustStatus('https://example.com');
    const trustContent = document.getElementById('statusTrustContent')!;
    expect(trustContent.innerHTML).toContain('No info');
    expect(trustContent.innerHTML).toContain('status-muted');
  });
});

describe('initAllUrlsPermissionBanner — all-URLs banner parity', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="allUrlsPermissionBanner"></div>
      <button id="btnRequestAllUrls"></button>
      <div id="statusTrustContent"></div>
    `;
    mockIsAllUrlsPermitted.mockResolvedValue(false);
  });

  it('resolves without throwing when the banner is missing', async () => {
    document.body.innerHTML = '';
    await expect(initAllUrlsPermissionBanner()).resolves.not.toThrow();
  });

  it('hides the banner when the permission is already granted', async () => {
    mockIsAllUrlsPermitted.mockResolvedValue(true);
    await initAllUrlsPermissionBanner();
    expect(document.getElementById('allUrlsPermissionBanner')!.classList.contains('hidden')).toBe(true);
  });

  it('shows the banner when the permission is missing', async () => {
    await initAllUrlsPermissionBanner();
    expect(document.getElementById('allUrlsPermissionBanner')!.classList.contains('hidden')).toBe(false);
  });

  it('on grant: hides the banner and refreshes trust through the active-tab seam', async () => {
    mockRequestAllUrls.mockResolvedValue(true);
    mockIsAllUrlsPermitted.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mockGetTrustLevelDisplay.mockResolvedValue({ level: 'Trusted' });
    mockCheckDomainTrust.mockResolvedValue({ showAlert: false, trustResult: {} });
    mockGetCurrentTab.mockResolvedValue({ url: 'https://example.com', id: 1 });

    await initAllUrlsPermissionBanner();
    const requestBtn = document.getElementById('btnRequestAllUrls') as HTMLButtonElement;
    requestBtn.click();
    await waitForMock(() => expect(mockRequestAllUrls).toHaveBeenCalled());
    await waitForMock(() => {
      expect(document.getElementById('allUrlsPermissionBanner')!.classList.contains('hidden')).toBe(true);
    });
    await waitForMock(() => {
      expect(document.getElementById('statusTrustContent')!.innerHTML).toContain('status-trust-trusted');
    });
  });

  it('keeps the banner when the request is denied', async () => {
    mockRequestAllUrls.mockResolvedValue(false);
    await initAllUrlsPermissionBanner();
    const requestBtn = document.getElementById('btnRequestAllUrls') as HTMLButtonElement;
    requestBtn.click();
    await drainMacrotask();
    expect(mockRequestAllUrls).toHaveBeenCalled();
    expect(document.getElementById('allUrlsPermissionBanner')!.classList.contains('hidden')).toBe(false);
  });

  it('reports a rejected request on mainStatus and the log (error contract)', async () => {
    mockRequestAllUrls.mockRejectedValue(new Error('user dismissed the prompt'));
    document.body.insertAdjacentHTML('beforeend', '<div id="mainStatus"></div>');
    await initAllUrlsPermissionBanner();
    const requestBtn = document.getElementById('btnRequestAllUrls') as HTMLButtonElement;
    requestBtn.click();
    await waitForMock(() => expect(mockLogError).toHaveBeenCalled());
    const status = document.getElementById('mainStatus')!;
    expect(status.textContent).toContain('user dismissed the prompt');
    expect(status.className).toBe('status-message error');
    expect(mockLogError).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ cause: expect.any(Error) }),
      'INT_001'
    );
  });
});

describe('reportHandlerError — shared failure path exported from trustPanel', () => {
  it('reports the derived sentence through the status seam and logs the cause', async () => {
    document.body.innerHTML = '<div id="mainStatus"></div>';
    reportHandlerError('Failed to request host permission', new Error('settings are locked'));
    await waitForMock(() => {
      const status = document.getElementById('mainStatus')!;
      expect(status.textContent).toContain('settings are locked');
      expect(status.className).toBe('status-message error');
    });
    expect(mockLogError).toHaveBeenCalledWith(
      'Failed to request host permission',
      expect.objectContaining({ cause: expect.any(Error) }),
      'INT_001'
    );
  });
});
