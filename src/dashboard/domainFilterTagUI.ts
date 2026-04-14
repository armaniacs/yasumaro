import { getMessage } from '../popup/i18n.js';
import { loadDomainSettings } from '../popup/domainFilter.js';

/**
 * Initialize the domain filter tag UI in settings panel
 * This provides a user-friendly tag-based interface for managing blacklisted/whitelisted domains
 */
export async function initDomainFilterTagUI(): Promise<void> {
  // --- hidden要素参照（domainFilter.ts が管理する既存ロジック）---
  const radioBlacklist  = document.getElementById('filterBlacklist')   as HTMLInputElement | null;
  const radioWhitelist  = document.getElementById('filterWhitelist')   as HTMLInputElement | null;
  const radioDisabled   = document.getElementById('filterDisabled')    as HTMLInputElement | null;
  const blacklistTA     = document.getElementById('blacklistTextarea') as HTMLTextAreaElement | null;
  const whitelistTA     = document.getElementById('whitelistTextarea') as HTMLTextAreaElement | null;
  const domainListTA    = document.getElementById('domainList')        as HTMLTextAreaElement | null;
  const realSaveBtn     = document.getElementById('saveDomainSettings') as HTMLButtonElement | null;
  const realStatus      = document.getElementById('domainStatus')      as HTMLElement | null;

  // --- 新UI要素参照 ---
  const toggle          = document.getElementById('domainFilterToggle')       as HTMLInputElement | null;
  const tabBar          = document.getElementById('domainModeTabBar')         as HTMLElement | null;
  const tagArea         = document.getElementById('domainTagArea')            as HTMLElement | null;
  const tabBlacklist    = document.getElementById('domainModeTab-blacklist')  as HTMLButtonElement | null;
  const tabWhitelist    = document.getElementById('domainModeTab-whitelist')  as HTMLButtonElement | null;
  const modeDesc        = document.getElementById('domainModeDesc')           as HTMLElement | null;
  const tagCount        = document.getElementById('domainTagCount')           as HTMLElement | null;
  const tagList         = document.getElementById('domainTagList')            as HTMLElement | null;
  const tagInput        = document.getElementById('domainTagInput')           as HTMLInputElement | null;
  const tagAddBtn       = document.getElementById('domainTagAddBtn')          as HTMLButtonElement | null;
  const tagError        = document.getElementById('domainTagError')           as HTMLElement | null;
  const saveBtn         = document.getElementById('domainSaveBtn')            as HTMLButtonElement | null;
  const saveStatus      = document.getElementById('domainSaveStatus')         as HTMLElement | null;

  if (!radioBlacklist || !radioWhitelist || !radioDisabled) return;

  function getCurrentMode(): 'blacklist' | 'whitelist' {
    return radioWhitelist!.checked ? 'whitelist' : 'blacklist';
  }

  function getTA(mode: 'blacklist' | 'whitelist'): HTMLTextAreaElement | null {
    return mode === 'blacklist' ? blacklistTA : whitelistTA;
  }

  function getDomains(mode: 'blacklist' | 'whitelist'): string[] {
    const ta = getTA(mode);
    if (!ta || !ta.value.trim()) return [];
    return ta.value.split('\n').map(d => d.trim()).filter(Boolean);
  }

  function setDomains(mode: 'blacklist' | 'whitelist', domains: string[]): void {
    const ta = getTA(mode);
    if (!ta) return;
    ta.value = domains.join('\n');
    // domainListTA も同期（domainFilter.ts の保存ロジック用）
    if (domainListTA) domainListTA.value = ta.value;
  }

  function updateModeDesc(mode: 'blacklist' | 'whitelist'): void {
    if (!modeDesc) return;
    if (mode === 'blacklist') {
      modeDesc.textContent = getMessage('domainBlacklistDesc') ||
        'ブラックリストのドメインは記録されません。それ以外はすべて記録されます。';
    } else {
      modeDesc.textContent = getMessage('domainWhitelistDesc') ||
        'ホワイトリストのドメインのみ記録されます。それ以外は記録されません。';
    }
  }

  function renderTags(mode: 'blacklist' | 'whitelist'): void {
    if (!tagList || !tagCount) return;
    const domains = getDomains(mode);
    tagCount.textContent = domains.length > 0
      ? (getMessage('domainTagCount') || '{count} 件')
          .replace('{count}', String(domains.length))
      : '';

    tagList.innerHTML = '';
    domains.forEach(domain => {
      const chip = document.createElement('span');
      chip.className = `domain-tag domain-tag-${mode}`;
      chip.setAttribute('role', 'listitem');

      const text = document.createElement('span');
      text.className = 'domain-tag-text';
      text.textContent = domain;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'domain-tag-remove';
      removeBtn.setAttribute('aria-label', `${domain} を削除`);
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => removeDomain(domain, mode));

      chip.appendChild(text);
      chip.appendChild(removeBtn);
      tagList.appendChild(chip);
    });
  }

  function addDomain(rawInput: string, mode: 'blacklist' | 'whitelist'): void {
    if (!tagError) return;
    tagError.textContent = '';
    const domain = rawInput.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!domain) return;

    // 簡易バリデーション
    if (!/^[a-z0-9.*-]+$/.test(domain)) {
      tagError.textContent = getMessage('domainTagInvalidError') || '無効なドメイン形式です。';
      return;
    }
    const existing = getDomains(mode);
    if (existing.includes(domain)) {
      tagError.textContent = getMessage('domainTagDuplicateError') || 'すでに登録されています。';
      return;
    }
    setDomains(mode, [...existing, domain]);
    renderTags(mode);
    if (tagInput) tagInput.value = '';
  }

  function removeDomain(domain: string, mode: 'blacklist' | 'whitelist'): void {
    const updated = getDomains(mode).filter(d => d !== domain);
    setDomains(mode, updated);
    renderTags(mode);
  }

  function switchTab(mode: 'blacklist' | 'whitelist'): void {
    if (mode === 'blacklist') {
      radioBlacklist!.checked = true;
      tabBlacklist?.classList.add('active');
      tabBlacklist?.setAttribute('aria-selected', 'true');
      tabWhitelist?.classList.remove('active');
      tabWhitelist?.setAttribute('aria-selected', 'false');
    } else {
      radioWhitelist!.checked = true;
      tabWhitelist?.classList.add('active');
      tabWhitelist?.setAttribute('aria-selected', 'true');
      tabBlacklist?.classList.remove('active');
      tabBlacklist?.setAttribute('aria-selected', 'false');
    }
    // domainListTA を現在モードの textarea に同期
    const ta = getTA(mode);
    if (domainListTA && ta) domainListTA.value = ta.value;
    updateModeDesc(mode);
    renderTags(mode);
    if (tagError) tagError.textContent = '';
  }

  function setEnabled(enabled: boolean): void {
    if (enabled) {
      radioDisabled!.checked = false;
      // 前回のモードを復元（どちらもチェックされていなければ blacklist をデフォルト）
      if (!radioBlacklist!.checked && !radioWhitelist!.checked) {
        radioBlacklist!.checked = true;
      }
    } else {
      radioDisabled!.checked = true;
      radioBlacklist!.checked = false;
      radioWhitelist!.checked = false;
    }
    tabBar?.toggleAttribute('hidden', !enabled);
    tagArea?.toggleAttribute('hidden', !enabled);
    if (toggle) {
      toggle.checked = enabled;
      toggle.setAttribute('aria-checked', String(enabled));
    }
    if (enabled) {
      switchTab(getCurrentMode());
    }
  }

  // loadDomainSettings() 完了後にUIを同期（setTimeout(0) で非同期実行待ち）
  function syncFromHidden(): void {
    const isEnabled = !radioDisabled!.checked;
    setEnabled(isEnabled);
    if (isEnabled) {
      switchTab(getCurrentMode());
    }
  }

  // --- イベント設定 ---
  toggle?.addEventListener('change', () => {
    setEnabled(toggle.checked);
  });

  tabBlacklist?.addEventListener('click', () => switchTab('blacklist'));
  tabWhitelist?.addEventListener('click', () => switchTab('whitelist'));

  tagAddBtn?.addEventListener('click', () => {
    if (tagInput) addDomain(tagInput.value, getCurrentMode());
  });

  tagInput?.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addDomain(tagInput.value, getCurrentMode());
    }
  });

  tagInput?.addEventListener('input', () => {
    if (tagError) tagError.textContent = '';
  });

  // 保存ボタン → 既存の hidden saveDomainSettings ボタンに委譲
  saveBtn?.addEventListener('click', () => {
    if (saveStatus) saveStatus.textContent = '';
    realSaveBtn?.click();
  });

  // realStatus を MutationObserver で監視して saveStatus に転写
  if (realStatus && saveStatus) {
    const observer = new MutationObserver(() => {
      saveStatus.textContent = realStatus.textContent || '';
      saveStatus.className = `status-message ${realStatus.className}`;
    });
    observer.observe(realStatus, { childList: true, characterData: true, subtree: true, attributes: true });
  }

  // 初期化: loadDomainSettings() を await して確実に同期
  await loadDomainSettings();
  syncFromHidden();
}
