/**
 * cspSettings.ts
 * Dashboard CSP設定UI管理
 * 条件付きCSP設定の表示・保存・読み込み
 *
 * CspSettingsController クラスとして実装し、DOM参照を
 * コンストラクタで注入可能にする。
 */

import { StorageKeys } from '../utils/storage/types.js';
import { CSPValidator } from '../utils/cspValidator.js';
import { settingsRepository, SettingsRepository, type SettingsReader } from '../utils/storage/SettingsRepository.js';
import { addLog, LogType } from '../utils/logger.js';
import { errorMessage } from '../utils/errorUtils.js';
import { getMessage } from '../utils/i18n.js';

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
  private repo: SettingsReader;

  constructor(domRefs?: CspSettingsDomRefs, repo: SettingsReader = settingsRepository) {
    if (domRefs) {
      this.resolveDom = () => domRefs;
    } else {
      this.resolveDom = resolveDefaultDomRefs;
    }
    this.repo = repo;
  }

  /**
   * CSP設定をロードしてUIに反映
   */
  async loadCSPSettings(): Promise<void> {
    try {
      const settings = await this.repo.getAll();
      const dom = this.resolveDom();

      if (dom.conditionalCspEnabled) {
        dom.conditionalCspEnabled.checked = settings[StorageKeys.CONDITIONAL_CSP_ENABLED] !== false;
      }

      CSPValidator.initializeFromSettings(settings);

      await this.renderProviderList(settings[StorageKeys.CONDITIONAL_CSP_PROVIDERS] ?? []);

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
      const dom = this.resolveDom();
      const enabled = dom.conditionalCspEnabled ? dom.conditionalCspEnabled.checked : true;

      const checkboxes = document.querySelectorAll('.csp-provider-checkbox:checked');
      const selectedProviders: string[] = [];
      checkboxes.forEach(checkbox => {
        const provider = checkbox.getAttribute('data-provider');
        if (provider) selectedProviders.push(provider);
      });

      await new SettingsRepository().setAll({
        [StorageKeys.CONDITIONAL_CSP_ENABLED]: enabled,
        [StorageKeys.CONDITIONAL_CSP_PROVIDERS]: selectedProviders
      });

      CSPValidator.reset();
      CSPValidator.initializeFromSettings({
        conditional_csp_enabled: enabled,
        conditional_csp_providers: selectedProviders
      });

      this.showMessage(dom.cspSaveMessage, getMessage('cspSaveSuccess'));
    } catch (error) {
      addLog(LogType.ERROR, 'CSP settings save failed', { error: errorMessage(error) });
      this.showMessage(this.resolveDom().cspSaveMessage, getMessage('cspSaveError'));
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
        // window.confirm はユーザーの同期的な判断を要する破壊的操作の確認であり、
        // テキスト表示のみの showMessage では代替できないため維持する
        // （dashboard内の他の削除確認と同じパターン）。
        if (window.confirm(getMessage('cspResetConfirm'))) {
          await this.resetCSPSettings();
        }
      });
    }
  }

  private async resetCSPSettings(): Promise<void> {
    try {
      await new SettingsRepository().setAll({
        [StorageKeys.CONDITIONAL_CSP_ENABLED]: true,
        [StorageKeys.CONDITIONAL_CSP_PROVIDERS]: []
      });

      await this.loadCSPSettings();
      this.showMessage(this.resolveDom().cspResetMessage, getMessage('cspResetSuccess'));
    } catch (error) {
      addLog(LogType.ERROR, 'CSP settings reset failed', { error: errorMessage(error) });
      this.showMessage(this.resolveDom().cspResetMessage, getMessage('cspResetError'));
    }
  }

  /**
   * 保存/リセットメッセージ要素にテキストを表示し、3秒後に非表示化する。
   * window.alert の代替として、cspSaveMessage/cspResetMessage 要素にインライン表示する。
   */
  private showMessage(element: HTMLElement | null, text: string): void {
    if (!element) return;
    element.textContent = text;
    element.style.display = 'block';
    setTimeout(() => { element.style.display = 'none'; }, 3000);
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

/**
 * デフォルトインスタンス。既存呼び出し元（staticPanels.ts等）はこれを使う。
 */
export const cspSettings = new CspSettingsController();
