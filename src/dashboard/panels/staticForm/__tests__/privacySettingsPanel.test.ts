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
}));

const mockGetPrivacyConsent = vi.fn();
const mockWithdrawPrivacyConsent = vi.fn();
vi.mock('../../../../utils/storage/privacyConsent.js', () => ({
  getPrivacyConsent: (...args: unknown[]) => mockGetPrivacyConsent(...args),
  withdrawPrivacyConsent: (...args: unknown[]) => mockWithdrawPrivacyConsent(...args),
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
}));

import { createPrivacySettingsPanel } from '../privacySettingsPanel.js';

function buildContainer(): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = `
    <div id="consentStatusDisplay" class="help-text"></div>
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
});
