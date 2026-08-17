/**
 * cspSettings.ts
 * Dashboard CSP設定UI管理
 * 条件付きCSP設定の表示・保存・読み込み
 *
 * CspSettingsController クラスとして実装し、DOM参照を
 * コンストラクタで注入可能にする。
 */

import { StorageKeys } from '../utils/storage.js';
import { CSPValidator } from '../utils/cspValidator.js';
import { getSettings, saveSettings } from '../utils/storage.js';
import { addLog, LogType } from '../utils/logger.js';
import { errorMessage } from '../utils/errorUtils.js';
import { getMessage } from '../utils/i18n.js';

/**
 * 正規表現特殊文字をエスケープする
 * @deprecated utils/string.ts に移動予定。現在は後方互換性のために維持。
 */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * i18nヘルパー関数
 * @deprecated utils/i18n.ts の getMessage を使用すること
 */
export function i18n(key: string, placeholders?: Record<string, string>): string {
  let message = getMessage(key);
  if (placeholders) {
    for (const [placeholder, value] of Object.entries(placeholders)) {
      const escapedPlaceholder = escapeRegExp(placeholder);
      message = message.replace(new RegExp(`\\$\\{${escapedPlaceholder}\\}`, 'g'), value);
    }
  }
  return message;
}

/**
 * CSP設定UIのDOM参照インターフェース。
 */
export interface CspSettingsDomRefs {
  conditionalCspEnabled: HTMLInputElement | null;
  cspProviderList: HTMLElement | null;
  cspProviderSearch: HTMLInputElement | null;
  cspSaveButton: HTMLElement | null;
  cspResetButton: HTMLElement | null;
  cspSaveMessage: HTMLElement | null;
  cspResetMessage: HTMLElement | null;
}

function resolveDefaultDomRefs(): CspSettingsDomRefs {
  return {
    conditionalCspEnabled: document.getElementById('conditionalCspEnabled') as HTMLInputElement | null,
    cspProviderList: document.getElementById('cspProviderList'),
    cspProviderSearch: document.getElementById('cspProviderSearch') as HTMLInputElement | null,
    cspSaveButton: document.getElementById('cspSaveButton'),
    cspResetButton: document.getElementById('cspResetButton'),
    cspSaveMessage: document.getElementById('cspSaveMessage'),
    cspResetMessage: document.getElementById('cspResetMessage'),
  };
}

/**
 * CSP設定UI管理コントローラー。
 * DOM参照は各メソッド呼び出し時に解決し、シングルトンでも安全に再利用できる。
 */
export class CspSettingsController {
  private resolveDom: () => CspSettingsDomRefs;

  constructor(domRefs?: CspSettingsDomRefs) {
    if (domRefs) {
      this.resolveDom = () => domRefs;
    } else {
      this.resolveDom = resolveDefaultDomRefs;
    }
  }

  /**
   * CSP設定をロードしてUIに反映
   */
  async loadCSPSettings(): Promise<void> {
    try {
      const settings = await getSettings();

      if (this.resolveDom().conditionalCspEnabled) {
        this.resolveDom().conditionalCspEnabled.checked = settings[StorageKeys.CONDITIONAL_CSP_ENABLED] !== false;
      }

      CSPValidator.initializeFromSettings(settings);

      await this.renderProviderList(settings[StorageKeys.CONDITIONAL_CSP_PROVIDERS] as string[] || []);

      this.bindSearchInput();
      this.bindSaveButton();
      this.bindResetButton();
    } catch (error) {
      addLog(LogType.ERROR, 'CSP settings load failed', { error: errorMessage(error) });
    }
  }

  /**
   * 利用可能なプロバイダーリストを描画
   */
  async renderProviderList(selectedProviders: string[]): Promise<void> {
    const container = this.resolveDom().cspProviderList;
    if (!container) return;

    const availableProviders = CSPValidator.getAvailableProviders();

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
      checkbox.checked = isSelected;

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
  async saveCSPSettings(): Promise<void> {
    try {
      const enabled = this.resolveDom().conditionalCspEnabled ? this.resolveDom().conditionalCspEnabled.checked : true;

      const checkboxes = document.querySelectorAll('.csp-provider-checkbox:checked');
      const selectedProviders: string[] = [];
      checkboxes.forEach(checkbox => {
        const provider = checkbox.getAttribute('data-provider');
        if (provider) selectedProviders.push(provider);
      });

      await saveSettings({
        [StorageKeys.CONDITIONAL_CSP_ENABLED]: enabled,
        [StorageKeys.CONDITIONAL_CSP_PROVIDERS]: selectedProviders
      });

      CSPValidator.reset();
      CSPValidator.initializeFromSettings({
        conditional_csp_enabled: enabled,
        conditional_csp_providers: selectedProviders
      });

      this.showSaveSuccess();
    } catch (error) {
      addLog(LogType.ERROR, 'CSP settings save failed', { error: errorMessage(error) });
      window.alert(i18n('cspSaveError'));
    }
  }

  private bindSearchInput(): void {
    const searchInput = this.resolveDom().cspProviderSearch;
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

  private bindSaveButton(): void {
    const saveButton = this.resolveDom().cspSaveButton;
    if (saveButton) {
      saveButton.addEventListener('click', async (e) => {
        e.preventDefault();
        await this.saveCSPSettings();
      });
    }
  }

  private bindResetButton(): void {
    const resetButton = this.resolveDom().cspResetButton;
    if (resetButton) {
      resetButton.addEventListener('click', async (e) => {
        e.preventDefault();
        if (window.confirm(i18n('cspResetConfirm'))) {
          await this.resetCSPSettings();
        }
      });
    }
  }

  private async resetCSPSettings(): Promise<void> {
    try {
      await saveSettings({
        [StorageKeys.CONDITIONAL_CSP_ENABLED]: true,
        [StorageKeys.CONDITIONAL_CSP_PROVIDERS]: []
      });

      await this.loadCSPSettings();
      this.showResetSuccess();
    } catch (error) {
      addLog(LogType.ERROR, 'CSP settings reset failed', { error: errorMessage(error) });
      window.alert(i18n('cspResetError'));
    }
  }

  private showSaveSuccess(): void {
    const message = this.resolveDom().cspSaveMessage;
    if (message) {
      message.textContent = i18n('cspSaveSuccess');
      message.style.display = 'block';
      setTimeout(() => { message.style.display = 'none'; }, 3000);
    }
  }

  private showResetSuccess(): void {
    const message = this.resolveDom().cspResetMessage;
    if (message) {
      message.textContent = i18n('cspResetSuccess');
      message.style.display = 'block';
      setTimeout(() => { message.style.display = 'none'; }, 3000);
    }
  }

  static async requestProviderPermission(provider: string): Promise<boolean> {
    try {
      const domain = CSPValidator.getProviderDomain(provider);
      if (!domain) {
        addLog(LogType.WARN, 'Unknown CSP provider', { provider });
        return false;
      }
      const granted = await chrome.permissions.request({ origins: [`https://${domain}/*`] });
      return granted === true;
    } catch (error) {
      addLog(LogType.ERROR, 'Failed to request provider permission', { provider, error: errorMessage(error) });
      return false;
    }
  }

  static async requestEssentialPermission(type: string): Promise<boolean> {
    try {
      let origins: string[];
      switch (type) {
        case 'github-raw': origins = ['https://raw.githubusercontent.com/*']; break;
        case 'tranco': origins = ['https://tranco-list.eu/*']; break;
        default:
          addLog(LogType.WARN, 'Unknown essential permission type', { type });
          return false;
      }
      const granted = await chrome.permissions.request({ origins });
      return granted === true;
    } catch (error) {
      addLog(LogType.ERROR, 'Failed to request essential permission', { type, error: errorMessage(error) });
      return false;
    }
  }

  static async hasPermission(provider: string): Promise<boolean> {
    try {
      const domain = CSPValidator.getProviderDomain(provider);
      if (!domain) return false;
      const hasPermission = await chrome.permissions.contains({ origins: [`https://${domain}/*`] });
      return hasPermission === true;
    } catch (error) {
      addLog(LogType.ERROR, 'Failed to check provider permission', { provider, error: errorMessage(error) });
      return false;
    }
  }
}

// ─── Backward-compatible static class ──────────────────────────────────

/**
 * @deprecated CspSettingsController を使用すること
 */
export class CSPSettings {
  static async loadCSPSettings(): Promise<void> {
    try {
      const settings = await getSettings();
      const enabledInput = document.getElementById('conditionalCspEnabled') as HTMLInputElement;
      if (enabledInput) {
        enabledInput.checked = settings[StorageKeys.CONDITIONAL_CSP_ENABLED] !== false;
      }
      CSPValidator.initializeFromSettings(settings);
      const container = document.getElementById('cspProviderList');
      if (container) {
        const availableProviders = CSPValidator.getAvailableProviders();
        const selectedProviders = (settings[StorageKeys.CONDITIONAL_CSP_PROVIDERS] as string[]) || [];
        const sortedProviders = [...availableProviders].sort((a, b) => {
          const aSel = selectedProviders.includes(a);
          const bSel = selectedProviders.includes(b);
          if (aSel && !bSel) return -1;
          if (!aSel && bSel) return 1;
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
          checkbox.checked = isSelected;
          const label = document.createElement('label');
          label.htmlFor = `csp-provider-${provider}`;
          label.className = 'csp-provider-label';
          label.textContent = `${provider} (${domain})`;
          row.appendChild(checkbox);
          row.appendChild(label);
          container.appendChild(row);
        }
      }
      const searchInput = document.getElementById('cspProviderSearch') as HTMLInputElement;
      if (searchInput) {
        searchInput.addEventListener('input', () => {
          const query = searchInput.value.toLowerCase();
          const rows = document.querySelectorAll<HTMLElement>('.csp-provider-row');
          rows.forEach(row => {
            const label = row.querySelector('.csp-provider-label')?.textContent?.toLowerCase() || '';
            row.style.display = label.includes(query) ? '' : 'none';
          });
        });
      }
      const saveButton = document.getElementById('cspSaveButton');
      if (saveButton) {
        saveButton.addEventListener('click', async (e) => {
          e.preventDefault();
          await CSPSettings.saveCSPSettings();
        });
      }
      const resetButton = document.getElementById('cspResetButton');
      if (resetButton) {
        resetButton.addEventListener('click', async (e) => {
          e.preventDefault();
          if (confirm(i18n('cspResetConfirm'))) {
            await CSPSettings.resetCSPSettings();
          }
        });
      }
    } catch (error) {
      addLog(LogType.ERROR, 'CSP settings load failed', { error: errorMessage(error) });
    }
  }

  static async renderProviderList(selectedProviders: string[]): Promise<void> {
    const container = document.getElementById('cspProviderList');
    if (!container) return;
    const availableProviders = CSPValidator.getAvailableProviders();
    const sortedProviders = [...availableProviders].sort((a, b) => {
      const aSel = selectedProviders.includes(a);
      const bSel = selectedProviders.includes(b);
      if (aSel && !bSel) return -1;
      if (!aSel && bSel) return 1;
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
      checkbox.checked = isSelected;
      const label = document.createElement('label');
      label.htmlFor = `csp-provider-${provider}`;
      label.className = 'csp-provider-label';
      label.textContent = `${provider} (${domain})`;
      row.appendChild(checkbox);
      row.appendChild(label);
      container.appendChild(row);
    }
  }

  static async saveCSPSettings(): Promise<void> {
    try {
      const enabledInput = document.getElementById('conditionalCspEnabled') as HTMLInputElement;
      const enabled = enabledInput ? enabledInput.checked : true;
      const checkboxes = document.querySelectorAll('.csp-provider-checkbox:checked');
      const selectedProviders: string[] = [];
      checkboxes.forEach(checkbox => {
        const provider = checkbox.getAttribute('data-provider');
        if (provider) selectedProviders.push(provider);
      });
      await saveSettings({
        [StorageKeys.CONDITIONAL_CSP_ENABLED]: enabled,
        [StorageKeys.CONDITIONAL_CSP_PROVIDERS]: selectedProviders
      });
      CSPValidator.reset();
      CSPValidator.initializeFromSettings({
        conditional_csp_enabled: enabled,
        conditional_csp_providers: selectedProviders
      });
      CSPSettings.showSaveSuccess();
    } catch (error) {
      addLog(LogType.ERROR, 'CSP settings save failed', { error: errorMessage(error) });
      alert(i18n('cspSaveError'));
    }
  }

  private static showSaveSuccess(): void {
    const message = document.getElementById('cspSaveMessage');
    if (message) {
      message.textContent = i18n('cspSaveSuccess');
      message.style.display = 'block';
      setTimeout(() => { message.style.display = 'none'; }, 3000);
    }
  }

  private static showResetSuccess(): void {
    const message = document.getElementById('cspResetMessage');
    if (message) {
      message.textContent = i18n('cspResetSuccess');
      message.style.display = 'block';
      setTimeout(() => { message.style.display = 'none'; }, 3000);
    }
  }

  private static async resetCSPSettings(): Promise<void> {
    try {
      await saveSettings({
        [StorageKeys.CONDITIONAL_CSP_ENABLED]: true,
        [StorageKeys.CONDITIONAL_CSP_PROVIDERS]: []
      });
      await CSPSettings.loadCSPSettings();
      CSPSettings.showResetSuccess();
    } catch (error) {
      addLog(LogType.ERROR, 'CSP settings reset failed', { error: errorMessage(error) });
      alert(i18n('cspResetError'));
    }
  }

  static async requestProviderPermission(provider: string): Promise<boolean> {
    return CspSettingsController.requestProviderPermission(provider);
  }

  static async requestEssentialPermission(type: string): Promise<boolean> {
    return CspSettingsController.requestEssentialPermission(type);
  }

  static async hasPermission(provider: string): Promise<boolean> {
    return CspSettingsController.hasPermission(provider);
  }
}
