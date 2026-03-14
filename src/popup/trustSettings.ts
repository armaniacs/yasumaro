/**
 * trustSettings.ts
 * Trust Database 設定管理モジュール（Phase 1）
 * Dashboard TrustパネルのUIロジック
 */

import type { TrancoTier, SafetyMode } from '../utils/trustDb/trustDbSchema.js';
import { getTrustDb } from '../utils/trustDb/trustDb.js';
import { getTrancoUpdater } from '../utils/trustDb/trancoUpdater.js';
import { logInfo, logWarn, logError, ErrorCode } from '../utils/logger.js';
import { getMessage } from './i18n.js';
import { getTrustChecker } from '../utils/trustChecker.js';

// ============================================================================
// DOM Elements
// ============================================================================

const safetyModeSelect = document.getElementById('safetyMode') as HTMLSelectElement;
const trancoTierSelect = document.getElementById('trancoTier') as HTMLSelectElement;
const trancoStatusDiv = document.getElementById('trancoStatus') as HTMLElement;
const updateTrancoBtn = document.getElementById('updateTrancoBtn') as HTMLButtonElement;
const jpAnchorListDiv = document.getElementById('jpAnchorList') as HTMLElement;
const jpAnchorAddInput = document.getElementById('jpAnchorAdd') as HTMLInputElement;
const jpAnchorAddBtn = document.getElementById('jpAnchorAddBtn') as HTMLButtonElement;
const sensitiveListDiv = document.getElementById('sensitiveList') as HTMLElement;
const sensitiveCategorySelect = document.getElementById('sensitiveCategory') as HTMLSelectElement;
const sensitiveAddInput = document.getElementById('sensitiveAdd') as HTMLInputElement;
const sensitiveAddBtn = document.getElementById('sensitiveAddBtn') as HTMLButtonElement;
const whitelistDiv = document.getElementById('whitelist') as HTMLElement;
const whitelistAddInput = document.getElementById('whitelistAdd') as HTMLInputElement;
const whitelistAddBtn = document.getElementById('whitelistAddBtn') as HTMLButtonElement;
const alertFinanceCheckbox = document.getElementById('alertFinance') as HTMLInputElement;
const alertSensitiveCheckbox = document.getElementById('alertSensitive') as HTMLInputElement;
const alertUnverifiedCheckbox = document.getElementById('alertUnverified') as HTMLInputElement;
const saveTrustSettingsBtn = document.getElementById('saveTrustSettings') as HTMLButtonElement;
const trustSettingsStatusDiv = document.getElementById('trustSettingsStatus') as HTMLElement;

// Category tabs
const categoryTabs = document.querySelectorAll<HTMLButtonElement>('.category-tab');
let currentCategory: 'finance' | 'gaming' | 'sns' = 'finance';

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

function showStatus(message: string, isError = false): void {
  if (!trustSettingsStatusDiv) return;
  trustSettingsStatusDiv.textContent = message;
  trustSettingsStatusDiv.className = isError ? 'status-message error' : 'status-message success';
  setTimeout(() => {
    trustSettingsStatusDiv.textContent = '';
    trustSettingsStatusDiv.className = 'status-message';
  }, 3000);
}

function updateTrancoStatus(status: {
  count?: number;
  lastUpdated?: string;
  tier?: string;
  updating?: boolean;
  error?: string;
}): void {
  if (!trancoStatusDiv) return;

  if (status.updating) {
    trancoStatusDiv.textContent = getMessage('trancoUpdating') || 'Updating...';
    trancoStatusDiv.className = 'status-message updating';
    return;
  }

  if (status.error) {
    trancoStatusDiv.textContent = status.error;
    trancoStatusDiv.className = 'status-message error';
    return;
  }

  const count = status.count ?? 0;
  const lastUpdated = (status.lastUpdated ?? getMessage('trancoNotUpdated')) || 'Not updated';
  const tierObj: Record<TrancoTier | string, string> = {
    top1k: getMessage('trancoTierTop1k') || 'Top 1,000',
    top10k: getMessage('trancoTierTop10k') || 'Top 10,000',
    top100k: getMessage('trancoTierTop100k') || 'Top 100,000'
  };
  const tierLabel = tierObj[status.tier as TrancoTier] || status.tier || '';

  trancoStatusDiv.textContent = getMessage('trancoStatusFormat')
    ?.replace('{count}', count.toString())
    .replace('{tier}', tierLabel)
    .replace('{lastUpdated}', lastUpdated)
    || `Domains: ${count} | Tier: ${tierLabel} | Last updated: ${lastUpdated}`;
  trancoStatusDiv.className = 'status-message';
}

// ============================================================================
// JP-Anchor List Management
// ============================================================================

function renderJpAnchorList(tlds: string[]): void {
  if (!jpAnchorListDiv) return;
  jpAnchorListDiv.innerHTML = '';

  tlds.forEach(tld => {
    const div = document.createElement('div');
    div.className = 'domain-tag';
    div.innerHTML = `
      <span>${tld}</span>
      <button class="domain-tag-remove" data-tld="${tld}" aria-label="Remove ${tld}">×</button>
    `;
    jpAnchorListDiv.appendChild(div);

    const removeBtn = div.querySelector('.domain-tag-remove') as HTMLButtonElement;
    removeBtn.addEventListener('click', () => {
      removeJpAnchorTld(tld);
    });
  });
}

async function addJpAnchorTld(tld: string): Promise<void> {
  const db = getTrustDb();
  await db.initialize();

  const result = await db.addJpAnchorTld(tld);

  if (!result.success) {
    showStatus((getMessage(result.error as any) || result.error || 'Error'), true);
    return;
  }

  renderJpAnchorList(db.getJpAnchorTlds());
  jpAnchorAddInput.value = '';
  showStatus((getMessage('jpAnchorAdded') || 'TLD added'));
}

async function removeJpAnchorTld(tld: string): Promise<void> {
  const db = getTrustDb();
  await db.initialize();

  await db.removeJpAnchorTld(tld);
  renderJpAnchorList(db.getJpAnchorTlds());
}

// ============================================================================
// Sensitive List Management
// ============================================================================

function renderSensitiveList(domains: string[], isWhitelist = false): void {
  const container = isWhitelist ? whitelistDiv : sensitiveListDiv;
  if (!container) return;
  container.innerHTML = '';

  domains.forEach(domain => {
    const div = document.createElement('div');
    div.className = 'domain-tag';
    div.innerHTML = `
      <span>${domain}</span>
      <button class="domain-tag-remove" data-domain="${domain}" aria-label="Remove ${domain}">×</button>
    `;
    container.appendChild(div);

    const removeBtn = div.querySelector('.domain-tag-remove') as HTMLButtonElement;
    removeBtn.addEventListener('click', () => {
      if (isWhitelist) {
        removeWhitelistDomain(domain);
      } else {
        removeSensitiveDomain(domain, currentCategory);
      }
    });
  });
}

async function addSensitiveDomain(domain: string, category: 'finance' | 'gaming' | 'sns'): Promise<void> {
  const db = getTrustDb();
  await db.initialize();

  const result = await db.addSensitiveDomain(domain, category);

  if (!result.success) {
    showStatus((getMessage(result.error as any) || result.error || 'Error'), true);
    return;
  }

  if (category === currentCategory) {
    renderSensitiveList(db.getSensitiveDomains(category));
  }
  sensitiveAddInput.value = '';
  showStatus((getMessage('sensitiveAdded') || 'Domain added'));
}

async function removeSensitiveDomain(domain: string, category: 'finance' | 'gaming' | 'sns'): Promise<void> {
  const db = getTrustDb();
  await db.initialize();

  await db.removeSensitiveDomain(domain);
  renderSensitiveList(db.getSensitiveDomains(category));
}

// ============================================================================
// Whitelist Management
// ============================================================================

async function addWhitelistDomain(domain: string): Promise<void> {
  const db = getTrustDb();
  await db.initialize();

  const result = await db.addToWhitelist(domain);

  if (!result.success) {
    showStatus((getMessage(result.error as any) || result.error || 'Error'), true);
    return;
  }

  renderWhitelistList(db.getWhitelist());
  whitelistAddInput.value = '';
  showStatus((getMessage('whitelistAdded') || 'Domain added'));
}

function renderWhitelistList(domains: string[]): void {
  renderSensitiveList(domains, true);
}

async function removeWhitelistDomain(domain: string): Promise<void> {
  const db = getTrustDb();
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
    showStatus((getMessage('trancoUpdateInProgress') || 'Update already in progress'), true);
    return;
  }

  updateTrancoStatus({ updating: true });

  try {
    const result = await updater.updateTrancoList(tier);

    if (result.success) {
      await loadTrustSettings(); // Reload settings to reflect changes
      showStatus(getMessage('trancoUpdateSuccess') || 'Tranco list updated successfully');
      logInfo('TrustSettings', { tier, count: result.domainsCount }, `Tranco update completed`);
    } else {
      logError('TrustSettings', { error: result.error }, ErrorCode.TRANC_FETCH_FAILED);
      updateTrancoStatus({ error: result.error || 'Update failed' });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError('TrustSettings', { error: errorMessage }, ErrorCode.TRANC_FETCH_FAILED);
    updateTrancoStatus({ error: errorMessage });
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
  showStatus((getMessage('safetyModeChanged') || 'Safety mode changed'));
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

  categoryTabs.forEach(tab => {
    if (tab.dataset.category === category) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  const db = getTrustDb();
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
  showStatus((getMessage('settingsSaved') || 'Settings saved'));
  logInfo('TrustSettings', { alertConfig: checker.getAlertConfig() }, 'Trust settings saved');
}

// ============================================================================
// Load Settings
// ============================================================================

export async function loadTrustSettings(): Promise<void> {
  const db = getTrustDb();
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
  await checker.loadAlertSettings();
  const alertConfig = checker.getAlertConfig();

  if (alertFinanceCheckbox) {
    alertFinanceCheckbox.checked = alertConfig.alertFinance;
  }
  if (alertSensitiveCheckbox) {
    alertSensitiveCheckbox.checked = alertConfig.alertSensitive;
  }
  if (alertUnverifiedCheckbox) {
    alertUnverifiedCheckbox.checked = alertConfig.alertUnverified;
  }
}

// ============================================================================
// Initialization
// ============================================================================

export function init(): void {
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
  if (jpAnchorAddInput) {
    jpAnchorAddInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addJpAnchorTld(jpAnchorAddInput.value.trim());
      }
    });
  }

  // Category tabs
  categoryTabs.forEach(tab => {
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
  if (sensitiveAddInput) {
    sensitiveAddInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (sensitiveCategorySelect) {
          addSensitiveDomain(sensitiveAddInput.value.trim(), sensitiveCategorySelect.value as 'finance' | 'gaming' | 'sns');
        }
      }
    });
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
  if (whitelistAddInput) {
    whitelistAddInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addWhitelistDomain(whitelistAddInput.value.trim());
      }
    });
  }

  // Save Settings button
  if (saveTrustSettingsBtn) {
    saveTrustSettingsBtn.addEventListener('click', saveTrustSettings);
  }

  logInfo('TrustSettings', {}, 'Trust settings module initialized');
}

/**
 * Export for dashboard.ts
 */
export default {
  init,
  loadTrustSettings
};