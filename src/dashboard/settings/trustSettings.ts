/**
 * trustSettings.ts
 * Trust Database 設定管理モジュール（Phase 1）
 * Dashboard TrustパネルのUIロジック
 */

import type { TrancoTier, SafetyMode } from '../../utils/trustDb/trustDbSchema.js';
import { errorMessage } from '../../utils/errorUtils.js';
import { StorageKeys } from '../../utils/storage/types.js';
import { getTrustDbAdmin } from '../../utils/trustDb/TrustDbAdmin.js';
import { getTrancoUpdater } from '../../utils/trustDb/trancoUpdater.js';
import { ErrorCode } from '../../utils/logger/types.js';
import { logInfo, logError } from '../../utils/logger/api.js';
import { getMessageOr, getMessageWithSubstitutions } from '../../utils/i18n.js';
import { getPluralKey } from '../../utils/i18nPlural.js';
import { getTrustChecker } from '../../utils/trustChecker.js';
import { showStatus } from '../../utils/ui/settingsUiHelper.js';

// ============================================================================
// DOM Elements (lazy init — same convention as customPromptManager.ts: module
// scope must not touch `document` so this module imports without a DOM)
// ============================================================================

let safetyModeSelect: HTMLSelectElement | null = null;
let trancoTierSelect: HTMLSelectElement | null = null;
let trancoStatusDiv: HTMLElement | null = null;
let updateTrancoBtn: HTMLButtonElement | null = null;
let jpAnchorListDiv: HTMLElement | null = null;
let jpAnchorAddInput: HTMLInputElement | null = null;
let jpAnchorAddBtn: HTMLButtonElement | null = null;
let sensitiveListDiv: HTMLElement | null = null;
let sensitiveCategorySelect: HTMLSelectElement | null = null;
let sensitiveAddInput: HTMLInputElement | null = null;
let sensitiveAddBtn: HTMLButtonElement | null = null;
let whitelistDiv: HTMLElement | null = null;
let whitelistAddInput: HTMLInputElement | null = null;
let whitelistAddBtn: HTMLButtonElement | null = null;
let alertFinanceCheckbox: HTMLInputElement | null = null;
let alertSensitiveCheckbox: HTMLInputElement | null = null;
let alertUnverifiedCheckbox: HTMLInputElement | null = null;
let saveTrustSettingsBtn: HTMLButtonElement | null = null;
let trustSettingsStatusDiv: HTMLElement | null = null;
// P0: 許可検討セクション
let thresholdInput: HTMLInputElement | null = null;

// Category tabs
let categoryTabs: NodeListOf<HTMLButtonElement> | null = null;
let currentCategory: 'finance' | 'gaming' | 'sns' = 'finance';

/**
 * Resolve all DOM references. Called at the top of init() and
 * loadTrustSettings() so importing this module never touches `document`.
 */
function resolveTrustDomElements(): void {
  safetyModeSelect = document.getElementById('safetyMode') as HTMLSelectElement | null;
  trancoTierSelect = document.getElementById('trancoTier') as HTMLSelectElement | null;
  trancoStatusDiv = document.getElementById('trancoStatus') as HTMLElement | null;
  updateTrancoBtn = document.getElementById('updateTrancoBtn') as HTMLButtonElement | null;
  jpAnchorListDiv = document.getElementById('jpAnchorList') as HTMLElement | null;
  jpAnchorAddInput = document.getElementById('jpAnchorAdd') as HTMLInputElement | null;
  jpAnchorAddBtn = document.getElementById('jpAnchorAddBtn') as HTMLButtonElement | null;
  sensitiveListDiv = document.getElementById('sensitiveList') as HTMLElement | null;
  sensitiveCategorySelect = document.getElementById('sensitiveCategory') as HTMLSelectElement | null;
  sensitiveAddInput = document.getElementById('sensitiveAdd') as HTMLInputElement | null;
  sensitiveAddBtn = document.getElementById('sensitiveAddBtn') as HTMLButtonElement | null;
  whitelistDiv = document.getElementById('whitelist') as HTMLElement | null;
  whitelistAddInput = document.getElementById('whitelistAdd') as HTMLInputElement | null;
  whitelistAddBtn = document.getElementById('whitelistAddBtn') as HTMLButtonElement | null;
  alertFinanceCheckbox = document.getElementById('alertFinance') as HTMLInputElement | null;
  alertSensitiveCheckbox = document.getElementById('alertSensitive') as HTMLInputElement | null;
  alertUnverifiedCheckbox = document.getElementById('alertUnverified') as HTMLInputElement | null;
  saveTrustSettingsBtn = document.getElementById('saveTrustSettings') as HTMLButtonElement | null;
  trustSettingsStatusDiv = document.getElementById('trustSettingsStatus') as HTMLElement | null;
  thresholdInput = document.getElementById('permissionThreshold') as HTMLInputElement | null;
  categoryTabs = document.querySelectorAll<HTMLButtonElement>('.category-tab');
}

/** Status helper that tolerates a missing status element (pre-init calls). */
function trustStatus(message: string, type: 'success' | 'error'): void {
  if (!trustSettingsStatusDiv) return;
  showStatus(trustSettingsStatusDiv, message, type);
}

// Safety Mode to Tranco Tier mapping
const SAFETY_MODE_TO_TIER: Record<SafetyMode, TrancoTier> = {
  strict: 'top1k',
  balanced: 'top10k',
  relaxed: 'top100k'
};

const TIER_TO_SAFETY_MODE: Record<TrancoTier, SafetyMode> = {
  top1k: 'strict',
  top10k: 'balanced',
  top100k: 'relaxed'
};

// ============================================================================
// Utility Functions
// ============================================================================

function updateTrancoStatus(status: {
  count?: number;
  lastUpdated?: string;
  tier?: string;
  updating?: boolean;
  error?: string;
}): void {
  if (!trancoStatusDiv) return;

  if (status.updating) {
    trancoStatusDiv.textContent = getMessageOr('trancoUpdating', 'Updating...');
    trancoStatusDiv.className = 'status-message updating';
    return;
  }

  if (status.error) {
    trancoStatusDiv.textContent = status.error;
    trancoStatusDiv.className = 'status-message error';
    return;
  }

  const count = status.count ?? 0;
  const lastUpdated = (status.lastUpdated ?? getMessageOr('trancoNotUpdated', 'Not updated')) || 'Not updated';
  const tierObj: Record<TrancoTier | string, string> = {
    top1k: getMessageOr('trancoTierTop1k', 'Top 1,000'),
    top10k: getMessageOr('trancoTierTop10k', 'Top 10,000'),
    top100k: getMessageOr('trancoTierTop100k', 'Top 100,000')};
  const tierLabel = tierObj[status.tier as TrancoTier] || status.tier || '';

  trancoStatusDiv.textContent = getMessageWithSubstitutions(getPluralKey('trancoStatusFormat', count), { count, tier: tierLabel, lastUpdated }, `Domains: ${count} | Tier: ${tierLabel} | Last updated: ${lastUpdated}`);
  trancoStatusDiv.className = 'status-message';
}

// ============================================================================
// JP-Anchor List Management
// ============================================================================

function renderJpAnchorList(tlds: string[]): void {
  // Resolve on first use so direct calls work without init(); the import
  // itself still never touches `document`.
  if (!jpAnchorListDiv) resolveTrustDomElements();
  // Local capture: module-level `let` narrowing does not persist into closures.
  const listDiv = jpAnchorListDiv;
  if (!listDiv) return;
  listDiv.textContent = '';

  tlds.forEach(tld => {
    const div = document.createElement('div');
    div.className = 'domain-tag';

    // XSS-safe: Use createElement and textContent instead of innerHTML
    const span = document.createElement('span');
    span.textContent = tld;
    div.appendChild(span);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'domain-tag-remove';
    removeBtn.textContent = '×';
    removeBtn.dataset.tld = tld;
    removeBtn.setAttribute('aria-label', `Remove ${tld}`);
    div.appendChild(removeBtn);

    listDiv.appendChild(div);

    removeBtn.addEventListener('click', () => {
      removeJpAnchorTld(tld);
    });
  });
}

async function addJpAnchorTld(tld: string): Promise<void> {
  const db = getTrustDbAdmin();
  await db.initialize();

  const result = await db.addJpAnchorTld(tld);

  if (!result.success) {
    trustStatus(getMessageOr(result.error ?? '', result.error || 'Error'), 'error');
    return;
  }

  renderJpAnchorList(db.getJpAnchorTlds());
  if (jpAnchorAddInput) jpAnchorAddInput.value = '';
  trustStatus(getMessageOr('jpAnchorAdded', 'TLD added'), 'success');
}

async function removeJpAnchorTld(tld: string): Promise<void> {
  const db = getTrustDbAdmin();
  await db.initialize();

  await db.removeJpAnchorTld(tld);
  renderJpAnchorList(db.getJpAnchorTlds());
}

// ============================================================================
// Sensitive List Management
// ============================================================================

function renderSensitiveList(domains: string[], isWhitelist = false): void {
  // Resolve on first use so direct calls work without init(); the import
  // itself still never touches `document`.
  if (!sensitiveListDiv || !whitelistDiv) resolveTrustDomElements();
  const container = isWhitelist ? whitelistDiv : sensitiveListDiv;
  if (!container) return;
  container.textContent = '';

  domains.forEach(domain => {
    const div = document.createElement('div');
    div.className = 'domain-tag';

    // XSS-safe: Use createElement and textContent instead of innerHTML
    const span = document.createElement('span');
    span.textContent = domain;
    div.appendChild(span);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'domain-tag-remove';
    removeBtn.textContent = '×';
    removeBtn.dataset.domain = domain;
    removeBtn.setAttribute('aria-label', `Remove ${domain}`);
    div.appendChild(removeBtn);

    container.appendChild(div);

    removeBtn.addEventListener('click', () => {
      if (isWhitelist) {
        removeWhitelistDomain(domain);
      } else {
        removeSensitiveDomain(domain, currentCategory);
      }
    });
  });
}

// Export for testing (also update the previous export)
export { renderJpAnchorList, renderSensitiveList };

async function addSensitiveDomain(domain: string, category: 'finance' | 'gaming' | 'sns'): Promise<void> {
  const db = getTrustDbAdmin();
  await db.initialize();

  const result = await db.addSensitiveDomain(domain, category);

  if (!result.success) {
    trustStatus(getMessageOr(result.error ?? '', result.error || 'Error'), 'error');
    return;
  }

  if (category === currentCategory) {
    renderSensitiveList(db.getSensitiveDomains(category));
  }
  if (sensitiveAddInput) sensitiveAddInput.value = '';
  trustStatus(getMessageOr('sensitiveAdded', 'Domain added'), 'success');
}

async function removeSensitiveDomain(domain: string, category: 'finance' | 'gaming' | 'sns'): Promise<void> {
  const db = getTrustDbAdmin();
  await db.initialize();

  await db.removeSensitiveDomain(domain);
  renderSensitiveList(db.getSensitiveDomains(category));
}

// ============================================================================
// Whitelist Management
// ============================================================================

async function addWhitelistDomain(domain: string): Promise<void> {
  const db = getTrustDbAdmin();
  await db.initialize();

  const result = await db.addToWhitelist(domain);

  if (!result.success) {
    trustStatus(getMessageOr(result.error ?? '', result.error || 'Error'), 'error');
    return;
  }

  renderWhitelistList(db.getWhitelist());
  if (whitelistAddInput) whitelistAddInput.value = '';
  trustStatus(getMessageOr('whitelistAdded', 'Domain added'), 'success');
}

function renderWhitelistList(domains: string[]): void {
  renderSensitiveList(domains, true);
}

async function removeWhitelistDomain(domain: string): Promise<void> {
  const db = getTrustDbAdmin();
  await db.initialize();

  await db.removeFromWhitelist(domain);
  renderWhitelistList(db.getWhitelist());
}

// ============================================================================
// Tranco Update
// ============================================================================

async function updateTrancoList(): Promise<void> {
  if (!trancoTierSelect) return;

  const tier = trancoTierSelect.value as TrancoTier;
  const updater = getTrancoUpdater();

  if (updater.isUpdateInProgress()) {
    trustStatus(getMessageOr('trancoUpdateInProgress', 'Update already in progress'), 'error');
    return;
  }

  updateTrancoStatus({ updating: true });

  try {
    const result = await updater.updateTrancoList(tier);

    if (result.success) {
      await loadTrustSettings(); // Reload settings to reflect changes
      trustStatus(getMessageOr('trancoUpdateSuccess', 'Tranco list updated successfully'), 'success');
      logInfo('TrustSettings', { tier, count: result.domainsCount }, `Tranco update completed`);
    } else {
      logError('TrustSettings', { error: result.error }, ErrorCode.TRANCO_FETCH_FAILED);
      updateTrancoStatus({ error: result.error || 'Update failed' });
    }
  } catch (error) {
    logError('TrustSettings', { error: errorMessage(error) }, ErrorCode.TRANCO_FETCH_FAILED);
    updateTrancoStatus({ error: errorMessage(error) });
  }
}

// ============================================================================
// Safety Mode & Tranco Tier Synchronization
// ============================================================================

function onSafetyModeChange(): void {
  if (!safetyModeSelect || !trancoTierSelect) return;

  const mode = safetyModeSelect.value as SafetyMode;
  const targetTier = SAFETY_MODE_TO_TIER[mode];

  trancoTierSelect.value = targetTier;
  trustStatus(getMessageOr('safetyModeChanged', 'Safety mode changed'), 'success');
}

function onTrancoTierChange(): void {
  if (!safetyModeSelect || !trancoTierSelect) return;

  const tier = trancoTierSelect.value as TrancoTier;
  const targetMode = TIER_TO_SAFETY_MODE[tier];

  safetyModeSelect.value = targetMode;
  updateTrancoStatus({ tier });
}

// ============================================================================
// Category Tab Switching
// ============================================================================

function switchCategory(category: 'finance' | 'gaming' | 'sns'): void {
  currentCategory = category;

  categoryTabs?.forEach(tab => {
    if (tab.dataset.category === category) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  const db = getTrustDbAdmin();
  db.initialize().then(() => {
    renderSensitiveList(db.getSensitiveDomains(category));
  });
}

// ============================================================================
// Save Settings
// ============================================================================

async function saveTrustSettings(): Promise<void> {
  const checker = getTrustChecker();
  await checker.saveAlertSettings({
    alertFinance: alertFinanceCheckbox?.checked ?? false,
    alertSensitive: alertSensitiveCheckbox?.checked ?? false,
    alertUnverified: alertUnverifiedCheckbox?.checked ?? false
  });

  // Note: Trust Database changes are already saved immediately when modified
  trustStatus(getMessageOr('settingsSaved', 'Settings saved'), 'success');
  const alertConfig = await checker.getAlertConfig();
  logInfo('TrustSettings', { alertConfig }, 'Trust settings saved');
}

// ============================================================================
// Load Settings
// ============================================================================

export async function loadTrustSettings(): Promise<void> {
  resolveTrustDomElements();
  const db = getTrustDbAdmin();
  await db.initialize();

  const dbData = db.getDatabase();
  if (!dbData) {
    // Database not initialized yet
    return;
  }

  // Safety Mode
  const currentTier = dbData.tranco.tier;
  const currentMode = TIER_TO_SAFETY_MODE[currentTier];

  if (safetyModeSelect) {
    safetyModeSelect.value = currentMode;
  }
  if (trancoTierSelect) {
    trancoTierSelect.value = currentTier;
  }

  // Tranco Status
  updateTrancoStatus({
    count: dbData.tranco.count,
    lastUpdated: dbData.tranco.lastUpdated || dbData.lastUpdated,
    tier: currentTier
  });

  // JP-Anchor List
  renderJpAnchorList(db.getJpAnchorTlds());

  // Sensitive List (default to finance)
  switchCategory('finance');

  // Whitelist
  renderWhitelistList(db.getWhitelist());

  // Alert Settings をTrustCheckerから読み込む
  const checker = getTrustChecker();
  const alertConfig = await checker.getAlertConfig();

  if (alertFinanceCheckbox) {
    alertFinanceCheckbox.checked = alertConfig.alertFinance;
  }
  if (alertSensitiveCheckbox) {
    alertSensitiveCheckbox.checked = alertConfig.alertSensitive;
  }
  if (alertUnverifiedCheckbox) {
    alertUnverifiedCheckbox.checked = alertConfig.alertUnverified;
  }

  // P0: 「許可を検討するサイト」セッションを描画
  await renderPermissionSuggestList();
}

// ============================================================================
// Initialization
// ============================================================================

export function init(): void {
  resolveTrustDomElements();
  // Safety Mode change
  if (safetyModeSelect) {
    safetyModeSelect.addEventListener('change', onSafetyModeChange);
  }

  // Tranco Tier change
  if (trancoTierSelect) {
    trancoTierSelect.addEventListener('change', onTrancoTierChange);
  }

  // Tranco Update button
  if (updateTrancoBtn) {
    updateTrancoBtn.addEventListener('click', updateTrancoList);
  }

  // JP-Anchor Add button
  if (jpAnchorAddBtn) {
    jpAnchorAddBtn.addEventListener('click', () => {
      if (jpAnchorAddInput) {
        addJpAnchorTld(jpAnchorAddInput.value.trim());
      }
    });
  }

  // JP-Anchor Enter key
  {
    const jpAnchorInput = jpAnchorAddInput;
    if (jpAnchorInput) {
      jpAnchorInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          addJpAnchorTld(jpAnchorInput.value.trim());
        }
      });
    }
  }

  // Category tabs
  categoryTabs?.forEach(tab => {
    tab.addEventListener('click', () => {
      const category = tab.dataset.category as 'finance' | 'gaming' | 'sns';
      if (category) {
        switchCategory(category);
      }
    });
  });

  // Sensitive Domain Add button
  if (sensitiveAddBtn) {
    sensitiveAddBtn.addEventListener('click', () => {
      if (sensitiveAddInput && sensitiveCategorySelect) {
        addSensitiveDomain(sensitiveAddInput.value.trim(), sensitiveCategorySelect.value as 'finance' | 'gaming' | 'sns');
      }
    });
  }

  // Sensitive Domain Enter key
  {
    const sensitiveInput = sensitiveAddInput;
    const categorySelect = sensitiveCategorySelect;
    if (sensitiveInput) {
      sensitiveInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (categorySelect) {
            addSensitiveDomain(sensitiveInput.value.trim(), categorySelect.value as 'finance' | 'gaming' | 'sns');
          }
        }
      });
    }
  }

  // Whitelist Add button
  if (whitelistAddBtn) {
    whitelistAddBtn.addEventListener('click', () => {
      if (whitelistAddInput) {
        addWhitelistDomain(whitelistAddInput.value.trim());
      }
    });
  }

  // Whitelist Enter key
  {
    const whitelistInput = whitelistAddInput;
    if (whitelistInput) {
      whitelistInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          addWhitelistDomain(whitelistInput.value.trim());
        }
      });
    }
  }

  // Save Settings button
  if (saveTrustSettingsBtn) {
    saveTrustSettingsBtn.addEventListener('click', saveTrustSettings);
  }

  logInfo('TrustSettings', {}, 'Trust settings module initialized');

  // P0: 許可検討セクションのイベントリスナー
  if (thresholdInput) {
    thresholdInput.addEventListener('change', async (e) => {
      const newValue = parseInt((e.target as HTMLInputElement).value, 10);
       if (newValue >= 1 && newValue <= 50) {
         await chrome.storage.local.set({ [StorageKeys.PERMISSION_NOTIFY_THRESHOLD]: newValue });
         const _ = await renderPermissionSuggestList(); // 再描画
       }
    });
  }

  document.getElementById('dismissAllPermissions')?.addEventListener('click', async () => {
    const { recordDomainDismissal } = await import('../../utils/permissionManager.js');
    const denied = await renderPermissionSuggestList();
    for (const { domain } of denied) {
      await recordDomainDismissal(domain);
    }
    await renderPermissionSuggestList(); // 再描画
  });
}

// ============================================================================
// P0: Permission Suggest Section（許可を検討するサイト）
// ============================================================================

/**
 * 許可を検討するサイトリストを描画
 * @returns 描画されたエントリの配列
 */
export async function renderPermissionSuggestList(): Promise<{ domain: string; count: number }[]> {
  const thresholdInput = document.getElementById('permissionThreshold') as HTMLInputElement;
  const section = document.getElementById('permissionSuggestSection');
  const list = document.getElementById('permissionSuggestList');
  if (!section || !list) {
    return [];
  }

  const threshold = thresholdInput ? parseInt(thresholdInput.value, 10) : 3;
  const { getFrequentDeniedDomains, requestPermission, removeDeniedDomain, recordDomainDismissal, isHostPermitted } =
    await import('../../utils/permissionManager.js');

  const denied = await getFrequentDeniedDomains(threshold);
  if (denied.length > 0) {
    section.classList.remove('hidden');
  } else {
    section.classList.add('hidden');
  }
  list.textContent = '';

  const entries: { domain: string; count: number }[] = [];
  for (const { domain, count } of denied) {
    entries.push({ domain, count });

    const row = document.createElement('div');
    row.className = 'permission-suggest-row';

    const span = document.createElement('span');
    span.textContent = `${domain} — ${count}${getMessageOr('permissionSuggestCount', '回訪問')}`;

    const allowed = await isHostPermitted(`https://${domain}`);
    if (!allowed) {
      const allowBtn = document.createElement('button');
      allowBtn.className = 'btn-secondary btn-sm permission-suggest-allow';
      allowBtn.textContent = getMessageOr('permissionSuggestAdd', '🔓 許可する');
      allowBtn.addEventListener('click', async () => {
        const granted = await requestPermission(`https://${domain}`);
        if (granted) {
          await removeDeniedDomain(domain);
          await renderPermissionSuggestList(); // 再描画
        }
      });

      const dismissBtn = document.createElement('button');
      dismissBtn.className = 'btn-icon permission-suggest-dismiss';
      dismissBtn.textContent = '×';
      dismissBtn.title = getMessageOr('permissionSuggestDismiss', '無視する（14日表示しない）');
      dismissBtn.addEventListener('click', async () => {
        await recordDomainDismissal(domain);
        await renderPermissionSuggestList(); // 再描画
      });

      row.appendChild(span);
      row.appendChild(allowBtn);
      row.appendChild(dismissBtn);
    } else {
      // 既に許可済みならdenied_domainsから削除
      await removeDeniedDomain(domain);
    }

    list.appendChild(row);
  }

  return entries;
}

