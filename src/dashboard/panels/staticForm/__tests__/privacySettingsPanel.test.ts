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
      i18n: { getMessage: (key: string) => key },
      storage: { local: { clear: vi.fn() } },
    };
    mockGetPrivacyConsent.mockResolvedValue({ hasConsented: true, consentDate: '2026-01-01' });
  });

  it('確認ダイアログでキャンセルした場合、SQLite削除も同意撤回も実行されない', async () => {
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

  it('確認後、SQLite削除→同意撤回の順で実行される', async () => {
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
    expect(clearOrder).toBeLessThan(withdrawOrder);
  });

  it('SQLite削除が失敗した場合、同意撤回は呼ばれない（不整合防止）', async () => {
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

  it('全データ削除の失敗理由が画面に出る', async () => {
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

  it('同意撤回が成功した場合、状態表示とステータスが i18n キー経由で更新される', async () => {
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

  it('同意撤回が失敗した場合、ステータスが i18n キー経由で更新される', async () => {
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
});
