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
vi.mock('../../../../popup/privacyConsent.js', () => ({
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
    mockClearAllLogs.mockResolvedValue(true);
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
    mockClearAllLogs.mockResolvedValue(false);

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
  });
});
