/**
 * dashboard.ts
 * ダッシュボードページのメイン初期化モジュール
 * popup.ts の設定ロジックを流用し、フルページダッシュボードとして動作する
 */

import { StorageKeys, getSettings, saveSettingsWithAllowedUrls } from '../utils/storage.js';
import { init as initDomainFilter } from '../popup/domainFilter.js';
import { init as initPrivacySettings } from '../popup/privacySettings.js';
import { init as initContentSettings } from '../popup/contentSettings.js';
import { init as initTrustSettings, loadTrustSettings } from '../popup/trustSettings.js';
import { initCustomPromptManager } from '../popup/customPromptManager.js';
import { loadSettingsToInputs, extractSettingsFromInputs } from '../popup/settingsUiHelper.js';
import { clearAllFieldErrors, validateAllFields, ErrorPair } from '../popup/settings/fieldValidation.js';
import { getMessage } from '../popup/i18n.js';
import { getAiSummaryCleansingSettings, applyAiSummaryCleansingSettingsToUI, setupAiSummaryCleansingEventListeners } from '../popup/aiSummaryCleansingSettings.js';
import { STATUS_COLORS } from '../constants/appConstants.js';
import { getPrivacyConsent, withdrawPrivacyConsent } from '../popup/privacyConsent.js';
import { setupAIProviderChangeListener, updateAIProviderVisibility, AIProviderElements } from '../popup/settings/aiProvider.js';
import { setupAllFieldValidations } from '../popup/settings/fieldValidation.js';
import { focusTrapManager } from '../popup/utils/focusTrap.js';
import { getSavedUrlEntries } from '../utils/storageUrls.js';
import { initHistoryPanel } from './historyPanel.js';
import { initSqliteHistoryPanel } from './sqliteHistoryPanel.js';
import { initRecordingTriggerSettings } from './recordingTriggerSettings.js';
import { exportMarkdown, exportCsv, exportJson, downloadText, downloadBlob } from './exportLogsService.js';
import { ModelsDevDialog } from './models-dev-dialog.js';
import { CSPSettings } from './cspSettings.js';
import { computeCleansingStats, renderStatsSummary, renderFunnelChart } from './cleansingStatsView.js';
import { initMasterPasswordSettings, loadMasterPasswordSettings } from './masterPassword.js';
import { initExportImport } from './exportImport.js';
import { initDomainFilterTagUI } from './domainFilterTagUI.js';
import { initTagsPanel } from './tagsPanel.js';
import { initDomainSearchPanel } from './domainSearchPanel.js';
import { initDiagnosticsPanel } from './diagnosticsPanel.js';
import { initTrancoConsentPanel } from './trancoConsent.js';
import { clearAllLogs } from './dashboardSqliteService.js';
import { showConfirmDialog } from './utils/confirmDialog.js';

// ============================================================================
// Sidebar Navigation
// ============================================================================

export function initSidebarNav(): void {
  const navBtns = document.querySelectorAll<HTMLButtonElement>('.sidebar-nav-btn');
  const panels = document.querySelectorAll<HTMLElement>('.panel');

  const sidebarNav = document.querySelector<HTMLElement>('.sidebar-nav');
  if (sidebarNav) {
    sidebarNav.setAttribute('role', 'tablist');
    sidebarNav.setAttribute('aria-orientation', 'vertical');
  }

  navBtns.forEach((btn, idx) => {
    btn.setAttribute('role', 'tab');
    if (!btn.id) btn.id = `sidebar-tab-${idx}`;
    const panelId = btn.getAttribute('data-panel');
    if (panelId) btn.setAttribute('aria-controls', panelId);
  });

  panels.forEach(panel => {
    panel.setAttribute('role', 'tabpanel');
    const controllingBtn = document.querySelector<HTMLButtonElement>(`[data-panel="${panel.id}"]`);
    if (controllingBtn) panel.setAttribute('aria-labelledby', controllingBtn.id);
  });

  const activateBtn = (index: number): void => {
    navBtns.forEach((b, i) => {
      const selected = i === index;
      b.setAttribute('aria-selected', String(selected));
      b.setAttribute('tabindex', selected ? '0' : '-1');
      if (selected) b.classList.add('active');
      else b.classList.remove('active');
    });
    const targetPanelId = navBtns[index]?.getAttribute('data-panel');
    panels.forEach(panel => {
      if (panel.id === targetPanelId) panel.classList.add('active');
      else panel.classList.remove('active');
    });
  };

  navBtns.forEach((btn, i) => {
    btn.addEventListener('click', () => {
      activateBtn(i);
      const targetPanelId = btn.getAttribute('data-panel');

      if (targetPanelId === 'panel-ai-summary-cleansing') {
        requestAnimationFrame(() => {
          getSavedUrlEntries().then(panelEntries => {
            const summaryEl = document.getElementById('cleansingStatsSummary') as HTMLElement | null;
            const chartEl = document.getElementById('cleansingFunnelChart') as HTMLCanvasElement | null;
            if (!summaryEl) return;
            const stats = computeCleansingStats(panelEntries);
            renderStatsSummary(summaryEl, stats);
            if (chartEl) {
              if (stats.count === 0) {
                chartEl.style.display = 'none';
              } else {
                chartEl.style.display = 'block';
                renderFunnelChart(chartEl, stats);
              }
            }
          }).catch(() => { /* ignore */ });
        });
      }
    });

    btn.addEventListener('keydown', (e) => {
      const key = e.key;
      let targetIndex: number | null = null;
      if (key === 'ArrowDown') targetIndex = (i + 1) % navBtns.length;
      else if (key === 'ArrowUp') targetIndex = (i - 1 + navBtns.length) % navBtns.length;
      else if (key === 'Home') targetIndex = 0;
      else if (key === 'End') targetIndex = navBtns.length - 1;
      if (targetIndex !== null) {
        e.preventDefault();
        navBtns[targetIndex]!.focus();
        activateBtn(targetIndex);
      }
    });
  });

  const activeIndex = Array.from(navBtns).findIndex(b => b.classList.contains('active'));
  activateBtn(activeIndex >= 0 ? activeIndex : 0);
}

// ============================================================================
// DOM Elements - General Settings Form (Lazy Initialization)
// ============================================================================
// Elements are fetched lazily to support testability (jsdom sets up DOM after import).

let _domElements: {
  apiKeyInput: HTMLInputElement | null;
  protocolInput: HTMLInputElement | null;
  portInput: HTMLInputElement | null;
  dailyPathInput: HTMLInputElement | null;
  aiProviderSelect: HTMLSelectElement | null;
  geminiSettingsDiv: HTMLElement | null;
  openaiSettingsDiv: HTMLElement | null;
  openai2SettingsDiv: HTMLElement | null;
  lmStudioSettingsDiv: HTMLElement | null;
  openaiCompatibleSettingsDiv: HTMLElement | null;
  geminiApiKeyInput: HTMLInputElement | null;
  geminiModelInput: HTMLInputElement | null;
  openaiBaseUrlInput: HTMLInputElement | null;
  openaiApiKeyInput: HTMLInputElement | null;
  openaiModelInput: HTMLInputElement | null;
  openai2BaseUrlInput: HTMLInputElement | null;
  openai2ApiKeyInput: HTMLInputElement | null;
  openai2ModelInput: HTMLInputElement | null;
  lmStudioBaseUrlInput: HTMLInputElement | null;
  lmStudioModelInput: HTMLInputElement | null;
  ollamaSettingsDiv: HTMLElement | null;
  ollamaBaseUrlInput: HTMLInputElement | null;
  ollamaModelInput: HTMLInputElement | null;
  providerBaseUrlInput: HTMLInputElement | null;
  providerApiKeyInput: HTMLInputElement | null;
  providerModelInput: HTMLInputElement | null;
  saveBtn: HTMLButtonElement | null;
  testObsidianBtn: HTMLButtonElement | null;
  testAiBtn: HTMLButtonElement | null;
  statusDiv: HTMLElement | null;
} | null = null;

export function resetDashboardElements(): void {
  _domElements = null;
}

export function getDashboardElements() {
  if (!_domElements && typeof document !== 'undefined') {
    _domElements = {
      apiKeyInput: document.getElementById('apiKey') as HTMLInputElement | null,
      protocolInput: document.getElementById('protocol') as HTMLInputElement | null,
      portInput: document.getElementById('port') as HTMLInputElement | null,
      dailyPathInput: document.getElementById('dailyPath') as HTMLInputElement | null,
      aiProviderSelect: document.getElementById('aiProvider') as HTMLSelectElement | null,
      geminiSettingsDiv: document.getElementById('geminiSettings') as HTMLElement | null,
      openaiSettingsDiv: document.getElementById('openaiSettings') as HTMLElement | null,
      openai2SettingsDiv: document.getElementById('openai2Settings') as HTMLElement | null,
      lmStudioSettingsDiv: document.getElementById('lm-studioSettings') as HTMLElement | null,
      openaiCompatibleSettingsDiv: document.getElementById('openai-compatibleSettings') as HTMLElement | null,
      geminiApiKeyInput: document.getElementById('geminiApiKey') as HTMLInputElement | null,
      geminiModelInput: document.getElementById('geminiModel') as HTMLInputElement | null,
      openaiBaseUrlInput: document.getElementById('openaiBaseUrl') as HTMLInputElement | null,
      openaiApiKeyInput: document.getElementById('openaiApiKey') as HTMLInputElement | null,
      openaiModelInput: document.getElementById('openaiModel') as HTMLInputElement | null,
      openai2BaseUrlInput: document.getElementById('openai2BaseUrl') as HTMLInputElement | null,
      openai2ApiKeyInput: document.getElementById('openai2ApiKey') as HTMLInputElement | null,
      openai2ModelInput: document.getElementById('openai2Model') as HTMLInputElement | null,
      lmStudioBaseUrlInput: document.getElementById('lmStudioBaseUrl') as HTMLInputElement | null,
      lmStudioModelInput: document.getElementById('lmStudioModel') as HTMLInputElement | null,
      ollamaSettingsDiv: document.getElementById('ollamaSettings') as HTMLElement | null,
      ollamaBaseUrlInput: document.getElementById('ollamaBaseUrl') as HTMLInputElement | null,
      ollamaModelInput: document.getElementById('ollamaModel') as HTMLInputElement | null,
      providerBaseUrlInput: document.getElementById('providerBaseUrl') as HTMLInputElement | null,
      providerApiKeyInput: document.getElementById('providerApiKey') as HTMLInputElement | null,
      providerModelInput: document.getElementById('providerModel') as HTMLInputElement | null,
      saveBtn: document.getElementById('save') as HTMLButtonElement | null,
      testObsidianBtn: document.getElementById('testObsidianBtn') as HTMLButtonElement | null,
      testAiBtn: document.getElementById('testAiBtn') as HTMLButtonElement | null,
      statusDiv: document.getElementById('status') as HTMLElement | null,
    };
  }
  return _domElements ?? {
    apiKeyInput: null, protocolInput: null, portInput: null, dailyPathInput: null,
    aiProviderSelect: null, geminiSettingsDiv: null, openaiSettingsDiv: null,
    openai2SettingsDiv: null, lmStudioSettingsDiv: null, openaiCompatibleSettingsDiv: null,
    geminiApiKeyInput: null, geminiModelInput: null, openaiBaseUrlInput: null,
    openaiApiKeyInput: null, openaiModelInput: null, openai2BaseUrlInput: null,
    openai2ApiKeyInput: null, openai2ModelInput: null, lmStudioBaseUrlInput: null,
    lmStudioModelInput: null, ollamaSettingsDiv: null, ollamaBaseUrlInput: null,
    ollamaModelInput: null, providerBaseUrlInput: null, providerApiKeyInput: null,
    providerModelInput: null, saveBtn: null,
    testObsidianBtn: null, testAiBtn: null, statusDiv: null,
  };
}

export function getSettingsMapping(): Record<string, HTMLInputElement | HTMLSelectElement | null> {
  const el = getDashboardElements();
  return {
    [StorageKeys.OBSIDIAN_API_KEY]: el.apiKeyInput,
    [StorageKeys.OBSIDIAN_PROTOCOL]: el.protocolInput,
    [StorageKeys.OBSIDIAN_PORT]: el.portInput,
    [StorageKeys.OBSIDIAN_DAILY_PATH]: el.dailyPathInput,
    [StorageKeys.AI_PROVIDER]: el.aiProviderSelect,
    [StorageKeys.GEMINI_API_KEY]: el.geminiApiKeyInput,
    [StorageKeys.GEMINI_MODEL]: el.geminiModelInput,
    [StorageKeys.OPENAI_BASE_URL]: el.openaiBaseUrlInput,
    [StorageKeys.OPENAI_API_KEY]: el.openaiApiKeyInput,
    [StorageKeys.OPENAI_MODEL]: el.openaiModelInput,
    [StorageKeys.OPENAI_2_BASE_URL]: el.openai2BaseUrlInput,
    [StorageKeys.OPENAI_2_API_KEY]: el.openai2ApiKeyInput,
    [StorageKeys.OPENAI_2_MODEL]: el.openai2ModelInput,
    [StorageKeys.LM_STUDIO_BASE_URL]: el.lmStudioBaseUrlInput,
    [StorageKeys.LM_STUDIO_MODEL]: el.lmStudioModelInput,
    [StorageKeys.OLLAMA_BASE_URL]: el.ollamaBaseUrlInput,
    [StorageKeys.OLLAMA_MODEL]: el.ollamaModelInput,
    [StorageKeys.PROVIDER_TYPE]: null,
    [StorageKeys.PROVIDER_BASE_URL]: el.providerBaseUrlInput,
    [StorageKeys.PROVIDER_API_KEY]: el.providerApiKeyInput,
    [StorageKeys.PROVIDER_MODEL]: el.providerModelInput,
  };
}

export function getAiProviderElements(): AIProviderElements {
  const el = getDashboardElements();
  return {
    select: el.aiProviderSelect as HTMLSelectElement,
    geminiSettings: el.geminiSettingsDiv as HTMLElement,
    openaiSettings: el.openaiSettingsDiv as HTMLElement,
    openai2Settings: el.openai2SettingsDiv as HTMLElement,
    lmStudioSettings: el.lmStudioSettingsDiv ?? undefined,
    ollamaSettings: el.ollamaSettingsDiv ?? undefined,
    openaiCompatibleSettings: el.openaiCompatibleSettingsDiv ?? undefined
  };
}

export async function loadGeneralSettings(): Promise<void> {
  const settings = await getSettings();
  loadSettingsToInputs(settings, getSettingsMapping());
  updateAIProviderVisibility(getAiProviderElements());

  // Load openai-compatible provider selection
  const selectedProviderInfoDiv = document.getElementById('selectedProviderInfo') as HTMLElement | null;
  const providerInfoDisplayDiv = document.getElementById('providerInfoDisplay') as HTMLElement | null;
  const providerType = settings[StorageKeys.PROVIDER_TYPE] as string;
  const providerBaseUrl = settings[StorageKeys.PROVIDER_BASE_URL] as string;
  if (providerType && providerBaseUrl && selectedProviderInfoDiv && providerInfoDisplayDiv) {
    selectedProviderInfoDiv.classList.remove('hidden');
    providerInfoDisplayDiv.textContent = `${providerType} (${providerBaseUrl})`;
  } else if (selectedProviderInfoDiv) {
    selectedProviderInfoDiv.classList.add('hidden');
  }
}

// ============================================================================
// Connection Test Helpers
// ============================================================================

export function createConnectionStatusElement(label: string, result: { success: boolean; message: string }, successColor: string, errorColor: string): HTMLElement {
  const statusDiv = document.createElement('div');
  statusDiv.style.marginBottom = '8px';

  const labelEl = document.createElement('strong');
  labelEl.textContent = `${label}: `;
  statusDiv.appendChild(labelEl);

  const spanEl = document.createElement('span');
  if (result.success) {
    spanEl.textContent = getMessage('connectionSuccess') || '接続成功';
    spanEl.style.color = successColor;
  } else {
    spanEl.textContent = result.message;
    spanEl.style.color = errorColor;
  }
  statusDiv.appendChild(spanEl);

  return statusDiv;
}

export async function testObsidianConnection(apiKey: string): Promise<{ success: boolean; message: string }> {
  const el = getDashboardElements();
  const testResult = await chrome.runtime.sendMessage({
    type: 'TEST_OBSIDIAN',
    payload: apiKey
      ? {
          protocol: el.protocolInput?.value?.trim(),
          port: el.portInput?.value?.trim(),
          apiKey: apiKey,
        }
      : {}
  }) as { obsidian?: { success: boolean; message: string } };

  return testResult?.obsidian || { success: false, message: 'No response' };
}

export async function testAiConnection(): Promise<{ success: boolean; message: string }> {
  const testResult = await chrome.runtime.sendMessage({
    type: 'TEST_AI',
    payload: {}
  }) as { ai?: { success: boolean; message: string } };

  return testResult?.ai || { success: false, message: 'No response' };
}

export async function handleSaveOnly(): Promise<void> {
  const el = getDashboardElements();
  if (!el.statusDiv) return;
  el.statusDiv.textContent = '';
  el.statusDiv.className = '';

  const errorPairs: ErrorPair[] = [
    [el.protocolInput, 'protocolError'],
    [el.portInput, 'portError'],
  ];
  clearAllFieldErrors(errorPairs);

  if (!validateAllFields(el.protocolInput, el.portInput)) {
    return;
  }

  const newSettings = extractSettingsFromInputs(getSettingsMapping());

  const currentSettings = await getSettings();
  const mergedSettings = { ...currentSettings, ...newSettings };
  await saveSettingsWithAllowedUrls(mergedSettings);

  el.statusDiv.textContent = getMessage('saveSuccess') || '設定を保存しました。';
  el.statusDiv.className = 'success';
}

export async function handleTestObsidian(): Promise<void> {
  const el = getDashboardElements();
  if (!el.testObsidianBtn || !el.statusDiv) return;

  el.statusDiv.innerHTML = '';
  el.statusDiv.className = '';
  el.statusDiv.textContent = getMessage('testingConnection') || '接続テスト中...';

  el.testObsidianBtn.disabled = true;
  try {
    const typedApiKey = el.apiKeyInput?.value?.trim();
    const obsidianResult = await testObsidianConnection(typedApiKey || '');

    el.statusDiv.innerHTML = '';
    el.statusDiv.appendChild(createConnectionStatusElement('Obsidian', obsidianResult, STATUS_COLORS.SUCCESS, STATUS_COLORS.ERROR));

    // HTTPS証明書警告
    if (!obsidianResult.success && obsidianResult.message.includes('Failed to fetch') && el.protocolInput?.value === 'https') {
      const port = parseInt(el.portInput?.value?.trim() || '0', 10);
      const url = `https://127.0.0.1:${port}/`;
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.textContent = getMessage('acceptCertificate') || '証明書を承認する';
      link.rel = 'noopener noreferrer';
      el.statusDiv.appendChild(document.createElement('br'));
      el.statusDiv.appendChild(link);
    }

    el.statusDiv.className = obsidianResult.success ? 'success' : 'error';
  } catch (e) {
    el.statusDiv.textContent = getMessage('testError') || '接続テストに失敗しました。';
    el.statusDiv.className = 'error';
  } finally {
    el.testObsidianBtn.disabled = false;
  }
}

export async function handleTestAi(): Promise<void> {
  const el = getDashboardElements();
  if (!el.testAiBtn || !el.statusDiv) return;

  el.statusDiv.innerHTML = '';
  el.statusDiv.className = '';
  el.statusDiv.textContent = getMessage('testingConnection') || '接続テスト中...';

  el.testAiBtn.disabled = true;
  try {
    const aiResult = await testAiConnection();

    el.statusDiv.innerHTML = '';
    el.statusDiv.appendChild(createConnectionStatusElement('AI', aiResult, STATUS_COLORS.SUCCESS, STATUS_COLORS.ERROR));

    el.statusDiv.className = aiResult.success ? 'success' : 'error';
  } catch (e) {
    el.statusDiv.textContent = getMessage('testError') || '接続テストに失敗しました。';
    el.statusDiv.className = 'error';
  } finally {
    el.testAiBtn.disabled = false;
  }
}

// Breaking Changes Notification Modal
// ============================================================================

let breakingChangesTrapId: string | null = null;

const BREAKING_CHANGES_SHOWN_KEY = 'breaking_changes_v5_shown';

function getBreakingChangesElements() {
  return {
    modal: document.getElementById('breakingChangesModal') as HTMLElement | null,
    closeBtn: document.getElementById('closeBreakingChangesModalBtn') as HTMLButtonElement | null,
    dismissBtn: document.getElementById('dismissBreakingChangesModalBtn') as HTMLButtonElement | null,
  };
}

async function showBreakingChangesModal(): Promise<void> {
  // 既に表示済みの場合はスキップ
  const shown = await chrome.storage.local.get(BREAKING_CHANGES_SHOWN_KEY).then(result => result[BREAKING_CHANGES_SHOWN_KEY]);
  if (shown) return;

  const { modal, dismissBtn, closeBtn } = getBreakingChangesElements();
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  void modal.offsetHeight;
  modal.classList.add('show');

  // ボタンのイベントリスナー設定
  dismissBtn?.addEventListener('click', closeBreakingChangesModal);
  closeBtn?.addEventListener('click', closeBreakingChangesModal);

  // Focus trap
  breakingChangesTrapId = focusTrapManager.trap(modal, closeBreakingChangesModal);
  dismissBtn?.focus();
}

async function closeBreakingChangesModal(): Promise<void> {
  const { modal } = getBreakingChangesElements();
  if (!modal) return;
  modal.classList.remove('show');
  modal.style.display = 'none';
  modal.classList.add('hidden');
  if (breakingChangesTrapId) {
    focusTrapManager.release(breakingChangesTrapId);
    breakingChangesTrapId = null;
  }

  // 表示済みとして記録
  await chrome.storage.local.set({ [BREAKING_CHANGES_SHOWN_KEY]: true });
}

// ============================================================================
// Initialization
// ============================================================================

export function setHtmlLangDir(): void {
  const locale = chrome.i18n.getUILanguage();
  const langCode = locale.split('-')[0];
  document.documentElement.lang = locale;
  const rtlLanguages = ['ar', 'he', 'fa', 'ur', 'ku', 'yi', 'dv'];
  document.documentElement.dir = rtlLanguages.includes(langCode) ? 'rtl' : 'ltr';
}

async function initConsentWithdrawal(): Promise<void> {
    const display = document.getElementById('consentStatusDisplay');
    const btn = document.getElementById('btnWithdrawConsent');
    const statusEl = document.getElementById('withdrawConsentStatus');

    const state = await getPrivacyConsent();
    if (display) {
        display.textContent = state.hasConsented
            ? chrome.i18n.getMessage('consented') || `Consented (${state.consentDate || ''})`
            : chrome.i18n.getMessage('notConsented') || 'Not consented';
    }
    if (btn) {
        btn.classList.toggle('hidden', !state.hasConsented);
    }
    if (btn) {
        btn.addEventListener('click', async () => {
            const ok = await withdrawPrivacyConsent();
            if (statusEl) {
                statusEl.textContent = ok
                    ? 'Consent withdrawn. Recording will stop.'
                    : 'Failed to withdraw consent.';
                statusEl.style.color = ok ? 'var(--color-success-text)' : 'var(--color-error)';
            }
            if (display) {
                display.textContent = 'Not consented';
            }
            if (btn) {
                btn.classList.add('hidden');
            }
        });
    }
}

// ============================================================================
// Export Logs Panel
// ============================================================================

function initExportLogsPanel(): void {
  const jsonBtn = document.getElementById('export-json-btn');
  const mdBtn = document.getElementById('export-markdown-btn');
  const csvBtn = document.getElementById('export-csv-btn');
  const statusEl = document.getElementById('export-status');

  const showStatus = (msg: string, isError = false) => {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.display = '';
    statusEl.style.color = isError ? 'var(--color-error)' : 'var(--color-success-text)';
    setTimeout(() => { statusEl!.style.display = 'none'; }, 3000);
  };

  jsonBtn?.addEventListener('click', async () => {
    try {
      showStatus('Exporting JSON…');
      const blob = await exportJson();
      downloadBlob(blob, `yasumaro_export_${new Date().toISOString().split('T')[0]}.json`);
      showStatus('JSON export completed.');
    } catch (err) {
      showStatus(`Export failed: ${err}`, true);
    }
  });

  mdBtn?.addEventListener('click', async () => {
    try {
      showStatus('Exporting Markdown…');
      const md = await exportMarkdown();
      downloadText(md, `yasumaro_export_${new Date().toISOString().split('T')[0]}.md`, 'text/markdown');
      showStatus('Markdown export completed.');
    } catch (err) {
      showStatus(`Export failed: ${err}`, true);
    }
  });

  csvBtn?.addEventListener('click', async () => {
    try {
      showStatus('Exporting CSV…');
      const blob = await exportCsv();
      downloadBlob(blob, `yasumaro_export_${new Date().toISOString().split('T')[0]}.csv`);
      showStatus('CSV export completed.');
    } catch (err) {
      showStatus(`Export failed: ${err}`, true);
    }
  });
}

// ============================================================================
// Dashboard Initialization
// ============================================================================

(async function initDashboard(): Promise<void> {
  console.log('[Dashboard] Starting initialization...');

  try { setHtmlLangDir(); } catch (e) { console.error('[Dashboard] setHtmlLangDir error:', e); }

  initSidebarNav();

  // Auto-navigate to SQLite history if URL parameter is present
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('tab') === 'sqlite-history') {
    const historyBtn = document.querySelector('[data-panel="panel-sqlite-history"]') as HTMLButtonElement;
    if (historyBtn) historyBtn.click();
  }

  try { initDomainFilter(); } catch (e) { console.error('[Dashboard] initDomainFilter error:', e); }
  try { await initDomainFilterTagUI(); } catch (e) { console.error('[Dashboard] initDomainFilterTagUI error:', e); }
  try { initExportImport(); } catch (e) { console.error('[Dashboard] initExportImport error:', e); }
  try { initMasterPasswordSettings(); } catch (e) { console.error('[Dashboard] initMasterPasswordSettings error:', e); }
  try { initPrivacySettings(); } catch (e) { console.error('[Dashboard] initPrivacySettings error:', e); }
  try { initContentSettings(); } catch (e) { console.error('[Dashboard] initContentSettings error:', e); }
  try { initTrustSettings(); } catch (e) { console.error('[Dashboard] initTrustSettings error:', e); }
  try { await CSPSettings.loadCSPSettings(); } catch (e) { console.error('[Dashboard] loadCSPSettings error:', e); }
  try {
    const aiSummaryCleansingSettings = await getAiSummaryCleansingSettings();
    applyAiSummaryCleansingSettingsToUI(aiSummaryCleansingSettings);
    setupAiSummaryCleansingEventListeners();
  } catch (e) { console.error('[Dashboard] initAiSummaryCleansingSettings error:', e); }

  try {
    const settings = await getSettings();
    initCustomPromptManager(settings);
  } catch (e) { console.error('[Dashboard] initCustomPromptManager error:', e); }

  try { await loadGeneralSettings(); } catch (e) { console.error('[Dashboard] loadGeneralSettings error:', e); }
  try { await loadMasterPasswordSettings(); } catch (e) { console.error('[Dashboard] loadMasterPasswordSettings error:', e); }
  try { await initConsentWithdrawal(); } catch (e) { console.error('[Dashboard] initConsentWithdrawal error:', e); }
  try { await loadTrustSettings(); } catch (e) { console.error('[Dashboard] loadTrustSettings error:', e); }

  // Data erasure button (GDPR Art.17)
  document.getElementById('btnDeleteAllData')?.addEventListener('click', async () => {
    const confirmed = await showConfirmDialog({
      title: chrome.i18n.getMessage('confirmClearAllTitle') || 'Delete All History',
      message: chrome.i18n.getMessage('confirmClearAllMessage') || chrome.i18n.getMessage('deleteAllDataConfirm') || 'This will permanently delete all stored data. Continue?',
      confirmLabel: chrome.i18n.getMessage('confirmDelete') || 'Delete',
      cancelLabel: chrome.i18n.getMessage('cancel') || 'Cancel',
      dangerous: true,
    });
    if (!confirmed) return;
    try {
      await chrome.storage.local.clear();
      const sqliteResult = await clearAllLogs();
      if (!sqliteResult) {
        const statusEl = document.getElementById('deleteAllDataStatus');
        if (statusEl) statusEl.textContent = chrome.i18n.getMessage('deleteAllDataFailed') || 'Failed to clear browsing logs. Please try again.';
        return;
      }
      const statusEl = document.getElementById('deleteAllDataStatus');
      if (statusEl) statusEl.textContent = chrome.i18n.getMessage('deleteAllDataSuccess');
      setTimeout(() => window.location.reload(), 2000);
    } catch (e) {
      console.error('[Dashboard] Failed to delete all data:', e);
      const statusEl = document.getElementById('deleteAllDataStatus');
      if (statusEl) statusEl.textContent = chrome.i18n.getMessage('deleteAllDataFailed') || 'Failed to delete all data. Please try again.';
    }
  });

  const aiProviderEl = getAiProviderElements();
  if (aiProviderEl.select) {
    setupAIProviderChangeListener(aiProviderEl);
  }

  // Initialize models.dev dialog
  let modelsDevDialog: ModelsDevDialog | null = null;

  const openModelsDevDialogBtn = document.getElementById('openModelsDevDialogBtn') as HTMLButtonElement;
  const selectedProviderInfoDiv = document.getElementById('selectedProviderInfo') as HTMLElement;
  const providerInfoDisplayDiv = document.getElementById('providerInfoDisplay') as HTMLElement;

  openModelsDevDialogBtn?.addEventListener('click', async () => {
    if (!modelsDevDialog) {
      modelsDevDialog = new ModelsDevDialog({
        onSave: async (providerId, baseUrl, apiKey, model) => {
          // Update UI
          selectedProviderInfoDiv?.classList.remove('hidden');
          const providerData = JSON.parse(JSON.stringify({ id: providerId, baseUrl, hasKey: !!apiKey, model }));
          providerInfoDisplayDiv!.textContent = `${providerId} (${baseUrl})${model ? ` - ${model}` : ''}`;

          // Update input values
          const el = getDashboardElements();
          if (el.providerApiKeyInput) el.providerApiKeyInput.value = apiKey;
          if (el.providerModelInput) el.providerModelInput.value = model;

          // Store in settings
          const settings = await getSettings();
          settings[StorageKeys.PROVIDER_TYPE] = providerId;
          settings[StorageKeys.PROVIDER_BASE_URL] = baseUrl;
          settings[StorageKeys.PROVIDER_API_KEY] = apiKey;
          settings[StorageKeys.PROVIDER_MODEL] = model;
          await saveSettingsWithAllowedUrls(settings);
        },
        onCancel: () => {
          console.log('[Dashboard] Provider dialog cancelled');
        }
      });
    }
    await modelsDevDialog.show();
  });
  // LM Studio preset button
  const lmStudioPresetBtn = document.getElementById('lmStudioPresetBtn') as HTMLButtonElement;
  lmStudioPresetBtn?.addEventListener('click', () => {
    const el = getDashboardElements();
    if (el.providerBaseUrlInput) el.providerBaseUrlInput.value = 'http://localhost:1234/v1';
    if (el.statusDiv) {
      el.statusDiv.textContent = getMessage('lmStudioPresetApplied') || 'LM Studio preset applied (http://localhost:1234/v1)';
      el.statusDiv.className = 'status-success';
    }
  });
  // Ollama preset button
  const ollamaPresetBtn = document.getElementById('ollamaPresetBtn') as HTMLButtonElement;
  ollamaPresetBtn?.addEventListener('click', () => {
    const el = getDashboardElements();
    if (el.providerBaseUrlInput) el.providerBaseUrlInput.value = 'http://localhost:11434/v1';
    if (el.statusDiv) {
      el.statusDiv.textContent = getMessage('ollamaPresetApplied') || 'Ollama preset applied (http://localhost:11434/v1)';
      el.statusDiv.className = 'status-success';
    }
  });
  {
    const el = getDashboardElements();
    setupAllFieldValidations(el.protocolInput, el.portInput);
  }

  // 保存ボタン（テストなし）
  {
    const el = getDashboardElements();
    el.saveBtn?.addEventListener('click', async () => {
      await handleSaveOnly();
    });

    // 接続テストボタン（保存なし）
    el.testObsidianBtn?.addEventListener('click', async () => {
      await handleTestObsidian();
    });

    el.testAiBtn?.addEventListener('click', async () => {
      await handleTestAi();
    });
  }

  try { await initHistoryPanel(); } catch (e) { console.error('[Dashboard] initHistoryPanel error:', e); }
  try { initSqliteHistoryPanel(); } catch (e) { console.error('[Dashboard] initSqliteHistoryPanel error:', e); }
  try { await initRecordingTriggerSettings(); } catch (e) { console.error('[Dashboard] initRecordingTriggerSettings error:', e); }
  try { initExportLogsPanel(); } catch (e) { console.error('[Dashboard] initExportLogsPanel error:', e); }
  try { await initDomainSearchPanel(); } catch (e) { console.error('[Dashboard] initDomainSearchPanel error:', e); }
  try { await initTagsPanel(); } catch (e) { console.error('[Dashboard] initTagsPanel error:', e); }
  try { await initDiagnosticsPanel(); } catch (e) { console.error('[Dashboard] initDiagnosticsPanel error:', e); }
  try { await showBreakingChangesModal(); } catch (e) { console.error('[Dashboard] showBreakingChangesModal error:', e); }
  try { await initTrancoConsentPanel(); } catch (e) { console.error('[Dashboard] initTrancoConsentPanel error:', e); }

  console.log('[Dashboard] Initialization complete');
})();

// Export for testability
export function initDashboard(): void {
  // This function can be called in tests to initialize the dashboard
  // In production, the IIFE above calls this automatically
}

