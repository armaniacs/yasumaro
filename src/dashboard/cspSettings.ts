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

    // 選択済みプロバイダーを先頭に、残りはアルファベット順
    const sortedProviders = [...availableProviders].sort((a, b) => {
      const aSelected = selectedProviders.includes(a);
      const bSelected = selectedProviders.includes(b);
      if (aSelected && !bSelected) return -1;
      if (!aSelected && bSelected) return 1;
      return a.localeCompare(b);
    });

    container.innerHTML = '';

    for (const provider of sortedProviders) {
      const domain = CSPValidator.getProviderDomain(provider);
      if (!domain) continue;

      const isSelected = selectedProviders.includes(provider);

      const row = document.createElement('div');
      row.className = 'csp-provider-row' + (isSelected ? ' csp-provider-row--active' : '');

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

  /**
   * AIプロバイダー権限リクエスト
   * @param provider - プロバイダーID
   * @returns 権限付与成功かどうか
   */
  static async requestProviderPermission(provider: string): Promise<boolean> {
    try {
      const domain = CSPValidator.getProviderDomain(provider);
      if (!domain) {
        console.warn(`Unknown provider: ${provider}`);
        return false;
      }

      const granted = await chrome.permissions.request({
        origins: [`https://${domain}/*`]
      });

      return granted === true;
    } catch (error) {
      console.error(`Failed to request permission for ${provider}:`, error);
      return false;
    }
  }

  /**
   * Essential機能の権限リクエスト
   * @param type - 機能種別 ('github-raw', 'tranco')
   * @returns 権限付与成功かどうか
   */
  static async requestEssentialPermission(type: string): Promise<boolean> {
    try {
      let origins: string[];

      switch (type) {
        case 'github-raw':
          origins = ['https://raw.githubusercontent.com/*'];
          break;
        case 'tranco':
          origins = ['https://tranco-list.eu/*'];
          break;
        default:
          console.warn(`Unknown essential permission type: ${type}`);
          return false;
      }

      const granted = await chrome.permissions.request({ origins });
      return granted === true;
    } catch (error) {
      console.error(`Failed to request ${type} permission:`, error);
      return false;
    }
  }

  /**
   * プロバイダー権限が付与されているか確認
   * @param provider - プロバイダーID
   * @returns 権限が付与されているか
   */
  static async hasPermission(provider: string): Promise<boolean> {
    try {
      const domain = CSPValidator.getProviderDomain(provider);
      if (!domain) {
        return false;
      }

      const hasPermission = await chrome.permissions.contains({
        origins: [`https://${domain}/*`]
      });

      return hasPermission === true;
    } catch (error) {
      console.error(`Failed to check permission for ${provider}:`, error);
      return false;
    }
  }
}

/**
 * 正規表現特殊文字をエスケープする
 * @param str - エスケープ対象の文字列
 * @returns エスケープされた文字列
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
      // プレースホルダーをエスケープして正規表現インジェクションを防止
      const escapedPlaceholder = escapeRegExp(placeholder);
      message = message.replace(new RegExp(`\\$\\{${escapedPlaceholder}\\}`, 'g'), value);
    }
  }
  return message;
}