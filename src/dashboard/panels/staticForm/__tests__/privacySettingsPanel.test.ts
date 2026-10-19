// @vitest-environment jsdom
/**
 * privacySettingsPanel.test.ts
 * 同意撤回時にデータ削除の確認ダイアログ→SQLite削除→同意撤回の順で
 * 実行されることを検証する（GDPR Art.7の実効性確保）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../settings/privacySettings.js', () => ({
  init: vi.fn(),
  loadPrivacySettings: vi.fn(),
}));

vi.mock('../../../masterPassword.js', () => ({
  initMasterPasswordSettings: vi.fn(),
  loadMasterPasswordSettings: vi.fn(),
}));

vi.mock('../../../../utils/i18n.js', () => ({
  getMessage: (key: string) => key,
  // Mirrors production semantics (message || fallback) so per-test
  // chrome.i18n.getMessage stubs keep controlling the outcome.
  getMessageOr: (key: string, fallback: string, subs?: unknown) =>
    ((globalThis as any).chrome?.i18n?.getMessage?.(key, subs) ?? '') || fallback,
}));

const mockGetPrivacyConsent = vi.fn();
const mockWithdrawPrivacyConsent = vi.fn();
const mockAcceptConsent = vi.fn();
const mockGetContentStorageEnabled = vi.fn();
const mockResetConsentDeniedCount = vi.fn();
vi.mock('../../../../utils/storage/privacyConsent.js', () => ({
  getPrivacyConsent: (...args: unknown[]) => mockGetPrivacyConsent(...args),
  withdrawPrivacyConsent: (...args: unknown[]) => mockWithdrawPrivacyConsent(...args),
  // PBI 2026-10-19-07: the panel owns the grant path as well.
  acceptConsent: (...args: unknown[]) => mockAcceptConsent(...args),
  getContentStorageEnabled: (...args: unknown[]) => mockGetContentStorageEnabled(...args),
  resetConsentDeniedCount: (...args: unknown[]) => mockResetConsentDeniedCount(...args),
}));

const mockShowConfirmDialog = vi.fn();
vi.mock('../../../utils/confirmDialog.js', () => ({
  showConfirmDialog: (...args: unknown[]) => mockShowConfirmDialog(...args),
}));

const mockClearAllLogs = vi.fn();
vi.mock('../../../dashboardSqliteService.js', () => ({
  clearAllLogs: (...args: unknown[]) => mockClearAllLogs(...args),
  // Mirrors the real narrowing helper: the panel imports it alongside
  // clearAllLogs to tell the failure side of ServiceResult apart.
  isServiceError: (r: unknown) => typeof r === 'object' && r !== null && 'error' in r,
}));

// PBI 2026-09-07-25: export-logs 遷移は registry 経由。DOM 迂回
// (sidebar ボタンの click シミュレート) が無いことを、sidebar 要素なしの
// DOM でも navigate が呼ばれることで証明する。
const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock('../../registryContext.js', () => ({
  getRegistry: () => ({ navigate: mockNavigate }),
  tryNavigate: (panelId: string, init?: Record<string, unknown>, onFailure?: () => void) => {
    try {
      Promise.resolve(init === undefined ? mockNavigate(panelId) : mockNavigate(panelId, init)).catch(() =>
        onFailure?.(),
      );
    } catch {
      onFailure?.();
    }
  },
}));

import { createPrivacySettingsPanel } from '../privacySettingsPanel.js';

function buildContainer(): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = `
    <div id="consentStatusDisplay" class="help-text"></div>
    <button type="button" id="btnGrantConsent" class="hidden"></button>
    <div id="grantConsentStatus" class="status-message"></div>
    <button type="button" id="btnWithdrawConsent" class="btn-danger"></button>
    <div id="withdrawConsentStatus" class="status-message"></div>
    <button type="button" id="btnDeleteAllData"></button>
    <div id="deleteAllDataStatus"></div>
    <button type="button" id="btnGoToExportLogs"></button>
  `;
  return container;
}

describe('privacySettingsPanel — 同意撤回フロー', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).chrome = {
      i18n: { getMessage: vi.fn((key: string) => key) },
      storage: { local: { clear: vi.fn() } },
    };
    mockGetPrivacyConsent.mockResolvedValue({ hasConsented: true, consentDate: '2026-01-01' });
  });

  it('runs neither SQLite deletion nor consent withdrawal when the confirm dialog is cancelled', async () => {
    mockShowConfirmDialog.mockResolvedValue(false);

    const panel = createPrivacySettingsPanel();
    const container = buildContainer();
    await panel.mount(container);

    const btn = container.querySelector('#btnWithdrawConsent') as HTMLButtonElement;
    btn.dispatchEvent(new Event('click'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockShowConfirmDialog).toHaveBeenCalledTimes(1);
    expect(mockClearAllLogs).not.toHaveBeenCalled();
    expect(mockWithdrawPrivacyConsent).not.toHaveBeenCalled();
  });

  it('runs SQLite deletion before consent withdrawal after confirmation', async () => {
    mockShowConfirmDialog.mockResolvedValue(true);
    mockClearAllLogs.mockResolvedValue({ data: undefined });
    mockWithdrawPrivacyConsent.mockResolvedValue({ withdrawalDate: '2026-07-26T00:00:00.000Z' });

    const panel = createPrivacySettingsPanel();
    const container = buildContainer();
    await panel.mount(container);

    const btn = container.querySelector('#btnWithdrawConsent') as HTMLButtonElement;
    btn.dispatchEvent(new Event('click'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockClearAllLogs).toHaveBeenCalledTimes(1);
    expect(mockWithdrawPrivacyConsent).toHaveBeenCalledTimes(1);

    // 呼び出し順序: clearAllLogs が withdrawPrivacyConsent より先
    const clearOrder = mockClearAllLogs.mock.invocationCallOrder[0];
    const withdrawOrder = mockWithdrawPrivacyConsent.mock.invocationCallOrder[0];
    expect(clearOrder).toBeDefined();
    expect(withdrawOrder).toBeDefined();
    expect(clearOrder!).toBeLessThan(withdrawOrder!);
  });

  it('does not call consent withdrawal when SQLite deletion fails (prevents inconsistency)', async () => {
    mockShowConfirmDialog.mockResolvedValue(true);
    mockClearAllLogs.mockResolvedValue({ error: 'Database is locked' });

    const panel = createPrivacySettingsPanel();
    const container = buildContainer();
    await panel.mount(container);

    const btn = container.querySelector('#btnWithdrawConsent') as HTMLButtonElement;
    btn.dispatchEvent(new Event('click'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockClearAllLogs).toHaveBeenCalledTimes(1);
    expect(mockWithdrawPrivacyConsent).not.toHaveBeenCalled();

    const statusEl = container.querySelector('#withdrawConsentStatus') as HTMLElement;
    expect(statusEl.textContent).toContain('withdrawConsentDataDeleteFailed');
    // The reason is what tells the user whether retrying is worth it; the
    // boolean the function used to return could not carry it.
    expect(statusEl.textContent).toContain('Database is locked');
  });

  it('renders the delete-all-data failure reason on screen', async () => {
    mockShowConfirmDialog.mockResolvedValue(true);
    mockClearAllLogs.mockResolvedValue({ error: 'Disk is full' });

    const panel = createPrivacySettingsPanel();
    const container = buildContainer();
    await panel.mount(container);

    const btn = container.querySelector('#btnDeleteAllData') as HTMLButtonElement;
    btn.dispatchEvent(new Event('click'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const statusEl = container.querySelector('#deleteAllDataStatus') as HTMLElement;
    expect(statusEl.textContent).toContain('deleteAllDataFailed');
    expect(statusEl.textContent).toContain('Disk is full');
  });

  it('updates the status display and status via i18n keys when consent withdrawal succeeds', async () => {
    mockShowConfirmDialog.mockResolvedValue(true);
    mockClearAllLogs.mockResolvedValue({ data: undefined });
    mockWithdrawPrivacyConsent.mockResolvedValue({ withdrawalDate: '2026-07-26T00:00:00.000Z' });

    const panel = createPrivacySettingsPanel();
    const container = buildContainer();
    await panel.mount(container);

    const btn = container.querySelector('#btnWithdrawConsent') as HTMLButtonElement;
    btn.dispatchEvent(new Event('click'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const display = container.querySelector('#consentStatusDisplay') as HTMLElement;
    expect(display.textContent).toBe('notConsented');
    const statusEl = container.querySelector('#withdrawConsentStatus') as HTMLElement;
    expect(statusEl.textContent).toBe('consentWithdrawnStopped');
    expect(btn.classList.contains('hidden')).toBe(true);
  });

  it('updates the status via i18n keys when consent withdrawal fails', async () => {
    mockShowConfirmDialog.mockResolvedValue(true);
    mockClearAllLogs.mockResolvedValue({ data: undefined });
    mockWithdrawPrivacyConsent.mockResolvedValue(null);

    const panel = createPrivacySettingsPanel();
    const container = buildContainer();
    await panel.mount(container);

    const btn = container.querySelector('#btnWithdrawConsent') as HTMLButtonElement;
    btn.dispatchEvent(new Event('click'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const statusEl = container.querySelector('#withdrawConsentStatus') as HTMLElement;
    expect(statusEl.textContent).toBe('consentWithdrawFailed');
  });

  it('renders via the consented key with the consent date when consented with a date', async () => {
    mockGetPrivacyConsent.mockResolvedValue({ hasConsented: true, consentDate: '2026-01-01' });
    const getMessage = (globalThis as any).chrome.i18n.getMessage;

    const panel = createPrivacySettingsPanel();
    const container = buildContainer();
    await panel.mount(container);

    expect(getMessage).toHaveBeenCalledWith('consented', ['2026-01-01']);
    const display = container.querySelector('#consentStatusDisplay') as HTMLElement;
    expect(display.textContent).toBe('consented');
  });

  it('renders via the consentedNoDate key when consented without a date', async () => {
    mockGetPrivacyConsent.mockResolvedValue({ hasConsented: true, consentDate: '' });

    const panel = createPrivacySettingsPanel();
    const container = buildContainer();
    await panel.mount(container);

    const display = container.querySelector('#consentStatusDisplay') as HTMLElement;
    expect(display.textContent).toBe('consentedNoDate');
  });

  it('renders via the notConsented key when not consented', async () => {
    mockGetPrivacyConsent.mockResolvedValue({ hasConsented: false, consentDate: '' });

    const panel = createPrivacySettingsPanel();
    const container = buildContainer();
    await panel.mount(container);

    const display = container.querySelector('#consentStatusDisplay') as HTMLElement;
    expect(display.textContent).toBe('notConsented');
  });

  it('falls back to English without breaking the display when the consented key is undefined', async () => {
    mockGetPrivacyConsent.mockResolvedValue({ hasConsented: true, consentDate: '2026-01-01' });
    (globalThis as any).chrome = {
      i18n: { getMessage: () => '' },
      storage: { local: { clear: vi.fn() } },
    };

    const panel = createPrivacySettingsPanel();
    const container = buildContainer();
    await panel.mount(container);

    const display = container.querySelector('#consentStatusDisplay') as HTMLElement;
    expect(display.textContent).toBe('Consented (2026-01-01)');
  });

  it('navigates to export-logs via registry.navigate (without DOM detour)', async () => {
    const panel = createPrivacySettingsPanel();
    const container = buildContainer();
    await panel.mount(container);

    // document には sidebar ボタンが存在しない: 旧実装の
    // querySelector('.sidebar-nav-btn...')?.click() なら何も起きない構成。
    expect(document.querySelector('.sidebar-nav-btn')).toBeNull();
    (container.querySelector('#btnGoToExportLogs') as HTMLButtonElement).click();

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('panel-export-logs');
  });

  // PBI 2026-10-19-07: after three declines the popup suppresses the consent
  // modal for 30 days and tells the user to consent from the settings screen.
  // That screen therefore has to own the grant path.
  describe('同意の付与（設定画面からの復帰経路）', () => {
    function grantButton(container: HTMLElement): HTMLButtonElement {
      return container.querySelector('#btnGrantConsent') as HTMLButtonElement;
    }

    function withdrawButton(container: HTMLElement): HTMLButtonElement {
      return container.querySelector('#btnWithdrawConsent') as HTMLButtonElement;
    }

    it('shows the grant action only while consent is missing', async () => {
      mockGetPrivacyConsent.mockResolvedValue({ hasConsented: false });

      const panel = createPrivacySettingsPanel();
      const container = buildContainer();
      await panel.mount(container);

      expect(grantButton(container).classList.contains('hidden')).toBe(false);
      expect(withdrawButton(container).classList.contains('hidden')).toBe(true);
    });

    it('hides the grant action for a consented profile', async () => {
      mockGetPrivacyConsent.mockResolvedValue({ hasConsented: true, consentDate: '2026-01-01' });

      const panel = createPrivacySettingsPanel();
      const container = buildContainer();
      await panel.mount(container);

      expect(grantButton(container).classList.contains('hidden')).toBe(true);
      expect(withdrawButton(container).classList.contains('hidden')).toBe(false);
    });

    it('grants consent with the current body-storage opt-in and ends the grace window', async () => {
      mockGetPrivacyConsent
        .mockResolvedValueOnce({ hasConsented: false })
        .mockResolvedValueOnce({ hasConsented: true, consentDate: '2026-10-19' });
      mockGetContentStorageEnabled.mockResolvedValue(true);
      mockAcceptConsent.mockResolvedValue(undefined);
      mockResetConsentDeniedCount.mockResolvedValue(undefined);

      const panel = createPrivacySettingsPanel();
      const container = buildContainer();
      await panel.mount(container);

      grantButton(container).click();
      await vi.waitFor(() => expect(mockAcceptConsent).toHaveBeenCalledTimes(1));

      // The opt-in is carried through, not reset to a default (scenario 6).
      expect(mockAcceptConsent).toHaveBeenCalledWith({ contentStorageEnabled: true });
      // A decline opened the 30-day grace window; an explicit grant closes it.
      expect(mockResetConsentDeniedCount).toHaveBeenCalledTimes(1);
      await vi.waitFor(() =>
        expect(grantButton(container).classList.contains('hidden')).toBe(true),
      );
      expect(withdrawButton(container).classList.contains('hidden')).toBe(false);
      // The i18n stub resolves keys to themselves, so the rendered value is the
      // message key — what matters is that it switched to the consented state.
      expect(container.querySelector('#consentStatusDisplay')?.textContent).toBe('consented');
    });

    it('reports a failed grant and does not pretend the state changed', async () => {
      mockGetPrivacyConsent.mockResolvedValue({ hasConsented: false });
      mockGetContentStorageEnabled.mockResolvedValue(false);
      mockAcceptConsent.mockRejectedValue(new Error('storage write failed'));

      const panel = createPrivacySettingsPanel();
      const container = buildContainer();
      await panel.mount(container);

      grantButton(container).click();
      await vi.waitFor(() =>
        expect(container.querySelector('#grantConsentStatus')?.textContent).toBe('consentGrantFailed'),
      );

      expect(mockResetConsentDeniedCount).not.toHaveBeenCalled();
      expect(grantButton(container).classList.contains('hidden')).toBe(false);
      expect(container.querySelector('#consentStatusDisplay')?.textContent).toBe('notConsented');
    });
  });
});
