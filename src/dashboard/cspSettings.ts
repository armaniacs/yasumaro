/**
 * cspSettings.ts
 * Dashboard CSP設定UI管理
 * 条件付きCSP設定の表示・保存・読み込み
 */

import { StorageKeys } from '../utils/storage.js';
import { CSPValidator } from '../utils/cspValidator.js';
import { getSettings, saveSettings } from '../utils/storage.js';

/**
 * CSP設定UI管理クラス
 */
export class CSPSettings {
  /**
   * CSP設定をロードしてUIに反映
   */
  static async loadCSPSettings(): Promise<void> {
    try {
      const settings = await getSettings();

      // 条件付きCSP有効フラグ
      const enabledInput = document.getElementById('conditionalCspEnabled') as HTMLInputElement;
      if (enabledInput) {
        enabledInput.checked = settings[StorageKeys.CONDITIONAL_CSP_ENABLED] !== false; // デフォルトはtrue
      }

      // CSPValidatorを初期化
      CSPValidator.initializeFromSettings(settings);

      // プロバイダーリストを描画
      CSPSettings.renderProviderList(settings[StorageKeys.CONDITIONAL_CSP_PROVIDERS] as string[] || []);

      // 検索ボックスイベント
      CSPSettings.bindSearchInput();

      // 保存ボタンイベント
      CSPSettings.bindSaveButton();

      // リセットボタンイベント
      CSPSettings.bindResetButton();
    } catch (error) {
      console.error('CSP settings load failed:', error);
    }
  }

  /**
   * 利用可能なプロバイダーリストを描画
   * @param selectedProviders - 選択されたプロバイダーID配列
   */
  static async renderProviderList(selectedProviders: string[]): Promise<void> {
    const container = document.getElementById('cspProviderList');
    if (!container) return;

    const availableProviders = CSPValidator.getAvailableProviders();
    container.innerHTML = '';

    for (const provider of availableProviders) {
      const domain = CSPValidator.getProviderDomain(provider);
      if (!domain) continue;

      const row = document.createElement('div');
      row.className = 'csp-provider-row';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `csp-provider-${provider}`;
      checkbox.className = 'csp-provider-checkbox';
      checkbox.dataset.provider = provider;
      checkbox.checked = selectedProviders.includes(provider);

      const label = document.createElement('label');
      label.htmlFor = `csp-provider-${provider}`;
      label.className = 'csp-provider-label';
      label.textContent = `${provider} (${domain})`;

      row.appendChild(checkbox);
      row.appendChild(label);
      container.appendChild(row);
    }
  }

  /**
   * CSP設定を保存
   */
  static async saveCSPSettings(): Promise<void> {
    try {
      const enabledInput = document.getElementById('conditionalCspEnabled') as HTMLInputElement;
      const enabled = enabledInput ? enabledInput.checked : true;

      // 選択されたプロバイダーを収集
      const checkboxes = document.querySelectorAll('.csp-provider-checkbox:checked');
      const selectedProviders: string[] = [];
      checkboxes.forEach(checkbox => {
        const provider = checkbox.getAttribute('data-provider');
        if (provider) {
          selectedProviders.push(provider);
        }
      });

      // 設定を保存
      await saveSettings({
        [StorageKeys.CONDITIONAL_CSP_ENABLED]: enabled,
        [StorageKeys.CONDITIONAL_CSP_PROVIDERS]: selectedProviders
      });

      // CSPValidatorを再初期化（リセットしてから再適用）
      CSPValidator.reset();
      CSPValidator.initializeFromSettings({
        conditional_csp_enabled: enabled,
        conditional_csp_providers: selectedProviders
      });

      // 保存成功通知
      CSPSettings.showSaveSuccess();
    } catch (error) {
      console.error('CSP settings save failed:', error);
      alert(i18n('cspSaveError'));
    }
  }

  
  /**
   * 検索ボックスイベントをバインド
   */
  private static bindSearchInput(): void {
    const searchInput = document.getElementById('cspProviderSearch') as HTMLInputElement;
    if (!searchInput) return;

    searchInput.addEventListener('input', () => {
      const query = searchInput.value.toLowerCase();
      const rows = document.querySelectorAll<HTMLElement>('.csp-provider-row');
      rows.forEach(row => {
        const label = row.querySelector('.csp-provider-label')?.textContent?.toLowerCase() || '';
        row.style.display = label.includes(query) ? '' : 'none';
      });
    });
  }

  /**
   * 保存ボタンイベントをバインド
   */
  private static bindSaveButton(): void {
    const saveButton = document.getElementById('cspSaveButton');
    if (saveButton) {
      saveButton.addEventListener('click', async (e) => {
        e.preventDefault();
        await CSPSettings.saveCSPSettings();
      });
    }
  }

  /**
   * リセットボタンイベントをバインド
   */
  private static bindResetButton(): void {
    const resetButton = document.getElementById('cspResetButton');
    if (resetButton) {
      resetButton.addEventListener('click', async (e) => {
        e.preventDefault();
        if (confirm(i18n('cspResetConfirm'))) {
          await CSPSettings.resetCSPSettings();
        }
      });
    }
  }

  /**
   * CSP設定をリセット
   */
  private static async resetCSPSettings(): Promise<void> {
    try {
      await saveSettings({
        [StorageKeys.CONDITIONAL_CSP_ENABLED]: true,
        [StorageKeys.CONDITIONAL_CSP_PROVIDERS]: []
      });

      // UIを再読み込み
      await CSPSettings.loadCSPSettings();

      CSPSettings.showResetSuccess();
    } catch (error) {
      console.error('CSP settings reset failed:', error);
      alert(i18n('cspResetError'));
    }
  }

  /**
   * 保存成功メッセージを表示
   */
  private static showSaveSuccess(): void {
    const message = document.getElementById('cspSaveMessage');
    if (message) {
      message.textContent = i18n('cspSaveSuccess');
      message.style.display = 'block';
      setTimeout(() => {
        message.style.display = 'none';
      }, 3000);
    }
  }

  /**
   * リセット成功メッセージを表示
   */
  private static showResetSuccess(): void {
    const message = document.getElementById('cspResetMessage');
    if (message) {
      message.textContent = i18n('cspResetSuccess');
      message.style.display = 'block';
      setTimeout(() => {
        message.style.display = 'none';
      }, 3000);
    }
  }
}

/**
 * i18nヘルパー関数
 * @param key - i18nキー
 * @param placeholders - プレースホルダー置換
 * @returns ローカルライズされた文字列
 */
function i18n(key: string, placeholders?: Record<string, string>): string {
  let message = chrome.i18n.getMessage(key);
  if (placeholders) {
    for (const [placeholder, value] of Object.entries(placeholders)) {
      message = message.replace(new RegExp(`\\$\\{${placeholder}\\}`, 'g'), value);
    }
  }
  return message;
}