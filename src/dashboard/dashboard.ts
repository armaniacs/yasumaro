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

// ============================================================================
// Sidebar Navigation
// ============================================================================

export function initSidebarNav(): void {
  const navBtns = document.querySelectorAll<HTMLButtonElement>('.sidebar-nav-btn');
  const panels = document.querySelectorAll<HTMLElement>('.panel');

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetPanelId = btn.getAttribute('data-panel');
      if (!targetPanelId) return;

      navBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      panels.forEach(panel => {
        if (panel.id === targetPanelId) {
          panel.classList.add('active');
        } else {
          panel.classList.remove('active');
        }
      });

      // AI Summary Cleansingパネル表示時にCanvas再描画（display:none時はwidth=0になるため）
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
  });
}

// ============================================================================
// DOM Elements - General Settings Form
// ============================================================================

const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const protocolInput = document.getElementById('protocol') as HTMLInputElement;
const portInput = document.getElementById('port') as HTMLInputElement;
const dailyPathInput = document.getElementById('dailyPath') as HTMLInputElement;

const aiProviderSelect = document.getElementById('aiProvider') as HTMLSelectElement;
const geminiSettingsDiv = document.getElementById('geminiSettings') as HTMLElement;
const openaiSettingsDiv = document.getElementById('openaiSettings') as HTMLElement;
const openai2SettingsDiv = document.getElementById('openai2Settings') as HTMLElement;
const lmStudioSettingsDiv = document.getElementById('lm-studioSettings') as HTMLElement;
const openaiCompatibleSettingsDiv = document.getElementById('openai-compatibleSettings') as HTMLElement;

const geminiApiKeyInput = document.getElementById('geminiApiKey') as HTMLInputElement;
const geminiModelInput = document.getElementById('geminiModel') as HTMLInputElement;

const openaiBaseUrlInput = document.getElementById('openaiBaseUrl') as HTMLInputElement;
const openaiApiKeyInput = document.getElementById('openaiApiKey') as HTMLInputElement;
const openaiModelInput = document.getElementById('openaiModel') as HTMLInputElement;

const openai2BaseUrlInput = document.getElementById('openai2BaseUrl') as HTMLInputElement;
const openai2ApiKeyInput = document.getElementById('openai2ApiKey') as HTMLInputElement;
const openai2ModelInput = document.getElementById('openai2Model') as HTMLInputElement;

const lmStudioBaseUrlInput = document.getElementById('lmStudioBaseUrl') as HTMLInputElement;
const lmStudioModelInput = document.getElementById('lmStudioModel') as HTMLInputElement;

const ollamaSettingsDiv = document.getElementById('ollamaSettings') as HTMLElement;
const ollamaBaseUrlInput = document.getElementById('ollamaBaseUrl') as HTMLInputElement;
const ollamaModelInput = document.getElementById('ollamaModel') as HTMLInputElement;

const providerBaseUrlInput = document.getElementById('providerBaseUrl') as HTMLInputElement;

const providerApiKeyInput = document.getElementById('providerApiKey') as HTMLInputElement;
const providerModelInput = document.getElementById('providerModel') as HTMLInputElement;

const minVisitDurationInput = document.getElementById('minVisitDuration') as HTMLInputElement;
const minScrollDepthInput = document.getElementById('minScrollDepth') as HTMLInputElement;
const maxTokensPerPromptInput = document.getElementById('maxTokensPerPrompt') as HTMLInputElement;
const aiTimeoutSecondsInput = document.getElementById('aiTimeoutSeconds') as HTMLInputElement;
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const testObsidianBtn = document.getElementById('testObsidianBtn') as HTMLButtonElement | null;
const testAiBtn = document.getElementById('testAiBtn') as HTMLButtonElement | null;
const statusDiv = document.getElementById('status') as HTMLElement;

const settingsMapping: Record<string, HTMLInputElement | HTMLSelectElement | null> = {
  [StorageKeys.OBSIDIAN_API_KEY]: apiKeyInput,
  [StorageKeys.OBSIDIAN_PROTOCOL]: protocolInput,
  [StorageKeys.OBSIDIAN_PORT]: portInput,
  [StorageKeys.OBSIDIAN_DAILY_PATH]: dailyPathInput,
  [StorageKeys.AI_PROVIDER]: aiProviderSelect,
  [StorageKeys.GEMINI_API_KEY]: geminiApiKeyInput,
  [StorageKeys.GEMINI_MODEL]: geminiModelInput,
  [StorageKeys.OPENAI_BASE_URL]: openaiBaseUrlInput,
  [StorageKeys.OPENAI_API_KEY]: openaiApiKeyInput,
  [StorageKeys.OPENAI_MODEL]: openaiModelInput,
  [StorageKeys.OPENAI_2_BASE_URL]: openai2BaseUrlInput,
  [StorageKeys.OPENAI_2_API_KEY]: openai2ApiKeyInput,
  [StorageKeys.OPENAI_2_MODEL]: openai2ModelInput,
  [StorageKeys.LM_STUDIO_BASE_URL]: lmStudioBaseUrlInput,
  [StorageKeys.LM_STUDIO_MODEL]: lmStudioModelInput,
  [StorageKeys.OLLAMA_BASE_URL]: ollamaBaseUrlInput,
  [StorageKeys.OLLAMA_MODEL]: ollamaModelInput,
  [StorageKeys.PROVIDER_TYPE]: null,
  [StorageKeys.PROVIDER_BASE_URL]: providerBaseUrlInput,
  [StorageKeys.PROVIDER_API_KEY]: providerApiKeyInput,
  [StorageKeys.PROVIDER_MODEL]: providerModelInput,
  [StorageKeys.MIN_VISIT_DURATION]: minVisitDurationInput,
  [StorageKeys.MIN_SCROLL_DEPTH]: minScrollDepthInput,
  [StorageKeys.MAX_TOKENS_PER_PROMPT]: maxTokensPerPromptInput
};

const aiProviderElements: AIProviderElements = {
  select: aiProviderSelect,
  geminiSettings: geminiSettingsDiv,
  openaiSettings: openaiSettingsDiv,
  openai2Settings: openai2SettingsDiv,
  lmStudioSettings: lmStudioSettingsDiv,
  ollamaSettings: ollamaSettingsDiv,
  openaiCompatibleSettings: openaiCompatibleSettingsDiv
};

export async function loadGeneralSettings(): Promise<void> {
  const settings = await getSettings();
  loadSettingsToInputs(settings, settingsMapping);
  updateAIProviderVisibility(aiProviderElements);

  // AIタイムアウト読み込み（0=自動のため空欄表示）
  const storedTimeoutMs = settings[StorageKeys.AI_TIMEOUT_MS] as number ?? 0;
  aiTimeoutSecondsInput.value = storedTimeoutMs > 0 ? String(storedTimeoutMs / 1000) : '';

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
  const testResult = await chrome.runtime.sendMessage({
    type: 'TEST_OBSIDIAN',
    payload: apiKey
      ? {
          protocol: protocolInput?.value?.trim(),
          port: portInput?.value?.trim(),
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
  statusDiv.textContent = '';
  statusDiv.className = '';

  const errorPairs: ErrorPair[] = [
    [protocolInput, 'protocolError'],
    [portInput, 'portError'],
    [minVisitDurationInput, 'minVisitDurationError'],
    [minScrollDepthInput, 'minScrollDepthError'],
    [maxTokensPerPromptInput, 'maxTokensError']
  ];
  clearAllFieldErrors(errorPairs);

  if (!validateAllFields(protocolInput, portInput, minVisitDurationInput, minScrollDepthInput, maxTokensPerPromptInput)) {
    return;
  }

  const newSettings = extractSettingsFromInputs(settingsMapping);

  // AIタイムアウト: 秒→ミリ秒変換（空欄=0=自動）
  const timeoutSec = parseFloat(aiTimeoutSecondsInput.value);
  newSettings[StorageKeys.AI_TIMEOUT_MS] = (!isNaN(timeoutSec) && timeoutSec >= 10) ? timeoutSec * 1000 : 0;

  const currentSettings = await getSettings();
  const mergedSettings = { ...currentSettings, ...newSettings };
  await saveSettingsWithAllowedUrls(mergedSettings);

  statusDiv.textContent = getMessage('saveSuccess') || '設定を保存しました。';
  statusDiv.className = 'success';
}

export async function handleTestObsidian(): Promise<void> {
  if (!testObsidianBtn) return;

  statusDiv.innerHTML = '';
  statusDiv.className = '';
  statusDiv.textContent = getMessage('testingConnection') || '接続テスト中...';

  testObsidianBtn.disabled = true;
  try {
    const typedApiKey = apiKeyInput?.value?.trim();
    const obsidianResult = await testObsidianConnection(typedApiKey || '');

    statusDiv.innerHTML = '';
    statusDiv.appendChild(createConnectionStatusElement('Obsidian', obsidianResult, STATUS_COLORS.SUCCESS, STATUS_COLORS.ERROR));

    // HTTPS証明書警告
    if (!obsidianResult.success && obsidianResult.message.includes('Failed to fetch') && protocolInput.value === 'https') {
      const port = parseInt(portInput.value.trim(), 10);
      const url = `https://127.0.0.1:${port}/`;
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.textContent = getMessage('acceptCertificate') || '証明書を承認する';
      link.rel = 'noopener noreferrer';
      statusDiv.appendChild(document.createElement('br'));
      statusDiv.appendChild(link);
    }

    statusDiv.className = obsidianResult.success ? 'success' : 'error';
  } catch (e) {
    statusDiv.textContent = getMessage('testError') || '接続テストに失敗しました。';
    statusDiv.className = 'error';
  } finally {
    testObsidianBtn.disabled = false;
  }
}

export async function handleTestAi(): Promise<void> {
  if (!testAiBtn) return;

  statusDiv.innerHTML = '';
  statusDiv.className = '';
  statusDiv.textContent = getMessage('testingConnection') || '接続テスト中...';

  testAiBtn.disabled = true;
  try {
    const aiResult = await testAiConnection();

    statusDiv.innerHTML = '';
    statusDiv.appendChild(createConnectionStatusElement('AI', aiResult, STATUS_COLORS.SUCCESS, STATUS_COLORS.ERROR));

    statusDiv.className = aiResult.success ? 'success' : 'error';
  } catch (e) {
    statusDiv.textContent = getMessage('testError') || '接続テストに失敗しました。';
    statusDiv.className = 'error';
  } finally {
    testAiBtn.disabled = false;
  }
}

// Breaking Changes Notification Modal
// ============================================================================

const breakingChangesModal = document.getElementById('breakingChangesModal') as HTMLElement | null;
const closeBreakingChangesModalBtn = document.getElementById('closeBreakingChangesModalBtn') as HTMLButtonElement | null;
const dismissBreakingChangesModalBtn = document.getElementById('dismissBreakingChangesModalBtn') as HTMLButtonElement | null;
let breakingChangesTrapId: string | null = null;

const BREAKING_CHANGES_SHOWN_KEY = 'breaking_changes_v5_shown';

async function showBreakingChangesModal(): Promise<void> {
  // 既に表示済みの場合はスキップ
  const shown = await chrome.storage.local.get(BREAKING_CHANGES_SHOWN_KEY).then(result => result[BREAKING_CHANGES_SHOWN_KEY]);
  if (shown) return;

  if (!breakingChangesModal) return;
  breakingChangesModal.classList.remove('hidden');
  breakingChangesModal.style.display = 'flex';
  void breakingChangesModal.offsetHeight;
  breakingChangesModal.classList.add('show');

  // Focus trap
  breakingChangesTrapId = focusTrapManager.trap(breakingChangesModal, closeBreakingChangesModal);
  dismissBreakingChangesModalBtn?.focus();
}

async function closeBreakingChangesModal(): Promise<void> {
  if (!breakingChangesModal) return;
  breakingChangesModal.classList.remove('show');
  breakingChangesModal.style.display = 'none';
  breakingChangesModal.classList.add('hidden');
  if (breakingChangesTrapId) {
    focusTrapManager.release(breakingChangesTrapId);
    breakingChangesTrapId = null;
  }

  // 表示済みとして記録
  await chrome.storage.local.set({ [BREAKING_CHANGES_SHOWN_KEY]: true });
}

closeBreakingChangesModalBtn?.addEventListener('click', closeBreakingChangesModal);
dismissBreakingChangesModalBtn?.addEventListener('click', closeBreakingChangesModal);
breakingChangesModal?.addEventListener('click', (e: MouseEvent) => {
  if (e.target === breakingChangesModal) closeBreakingChangesModal();
});

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

    btn?.addEventListener('click', async () => {
        if (!confirm(chrome.i18n.getMessage('withdrawConsentConfirm'))) return;
        try {
            await withdrawPrivacyConsent();
            if (statusEl) statusEl.textContent = chrome.i18n.getMessage('withdrawConsentSuccess');
            await initConsentWithdrawal(); // UI refresh
        } catch (e) {
            console.error('[Dashboard] Failed to withdraw consent:', e);
        }
    });
}

(async () => {
  console.log('[Dashboard] Starting initialization...');

  try { setHtmlLangDir(); } catch (e) { console.error('[Dashboard] setHtmlLangDir error:', e); }

  initSidebarNav();

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
    if (!confirm(chrome.i18n.getMessage('deleteAllDataConfirm'))) return;
    try {
      await chrome.storage.local.clear();
      const statusEl = document.getElementById('deleteAllDataStatus');
      if (statusEl) statusEl.textContent = chrome.i18n.getMessage('deleteAllDataSuccess');
      setTimeout(() => window.location.reload(), 2000);
    } catch (e) {
      console.error('[Dashboard] Failed to delete all data:', e);
    }
  });

  setupAIProviderChangeListener(aiProviderElements);

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
          providerApiKeyInput.value = apiKey;
          providerModelInput.value = model;

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
    providerBaseUrlInput.value = 'http://localhost:1234/v1';
    statusDiv.textContent = 'LM Studio preset applied (http://localhost:1234/v1)';
    statusDiv.className = 'status-success';
  });
  // Ollama preset button
  const ollamaPresetBtn = document.getElementById('ollamaPresetBtn') as HTMLButtonElement;
  ollamaPresetBtn?.addEventListener('click', () => {
    providerBaseUrlInput.value = 'http://localhost:11434/v1';
    statusDiv.textContent = 'Ollama preset applied (http://localhost:11434/v1)';
    statusDiv.className = 'status-success';
  });
  setupAllFieldValidations(protocolInput, portInput, minVisitDurationInput, minScrollDepthInput, maxTokensPerPromptInput);

  // 保存ボタン（テストなし）
  saveBtn?.addEventListener('click', async () => {
    await handleSaveOnly();
  });

  // 接続テストボタン（保存なし）
  testObsidianBtn?.addEventListener('click', async () => {
    await handleTestObsidian();
  });

  testAiBtn?.addEventListener('click', async () => {
    await handleTestAi();
  });

  try { await initHistoryPanel(); } catch (e) { console.error('[Dashboard] initHistoryPanel error:', e); }
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

