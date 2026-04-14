/**
 * dashboard.ts
 * ダッシュボードページのメイン初期化モジュール
 * popup.ts の設定ロジックを流用し、フルページダッシュボードとして動作する
 */

import { StorageKeys, getSettings, saveSettingsWithAllowedUrls, Settings } from '../utils/storage.js';
import type { TagCategory } from '../utils/types.js';
import { init as initDomainFilter, loadDomainSettings } from '../popup/domainFilter.js';
import { init as initPrivacySettings, loadPrivacySettings } from '../popup/privacySettings.js';
import { init as initContentSettings, loadContentSettings } from '../popup/contentSettings.js';
import { init as initTrustSettings, loadTrustSettings } from '../popup/trustSettings.js';
import { initCustomPromptManager } from '../popup/customPromptManager.js';
import { loadSettingsToInputs, extractSettingsFromInputs, showStatus } from '../popup/settingsUiHelper.js';
import { clearAllFieldErrors, validateAllFields, ErrorPair } from '../popup/settings/fieldValidation.js';
import { getMessage } from '../popup/i18n.js';
import { getAiSummaryCleansingSettings, applyAiSummaryCleansingSettingsToUI, setupAiSummaryCleansingEventListeners } from '../popup/aiSummaryCleansingSettings.js';
import { STATUS_COLORS, UI_COLORS, TIMEOUTS } from '../constants/appConstants.js';
import {
  exportSettings,
  importSettings,
  validateExportData,
  SettingsExportData,
  exportEncryptedSettings,
  importEncryptedSettings,
  saveEncryptedExportToFile,
  isEncryptedExport,
  EncryptedExportData,
  ExportFileData
} from '../utils/settingsExportImport.js';
import {
  setMasterPassword,
  verifyMasterPassword,
  isMasterPasswordSet,
  calculatePasswordStrength,
  validatePasswordRequirements,
  validatePasswordMatch
} from '../utils/masterPassword.js';
import { getPrivacyConsent, withdrawPrivacyConsent } from '../popup/privacyConsent.js';
import { setupAIProviderChangeListener, updateAIProviderVisibility, AIProviderElements } from '../popup/settings/aiProvider.js';
import { setupAllFieldValidations } from '../popup/settings/fieldValidation.js';
import { focusTrapManager } from '../popup/utils/focusTrap.js';
import { getSavedUrlsWithTimestamps, getSavedUrlEntries, removeSavedUrl, getSavedUrlCount, setUrlTags } from '../utils/storageUrls.js';
import { getPendingPages, removePendingPages } from '../utils/pendingStorage.js';
import { extractDomain, isDomainAllowed } from '../utils/domainUtils.js';
import { initHistoryPanel } from './historyPanel.js';
import { DEFAULT_CATEGORIES, getAllCategories } from '../utils/tagUtils.js';
import { ModelsDevDialog } from './models-dev-dialog.js';
import { CSPSettings } from './cspSettings.js';
import { computeCleansingStats, renderStatsSummary, renderFunnelChart, makeCleansingProgressBar } from './cleansingStatsView.js';

// ============================================================================
// Sidebar Navigation
// ============================================================================

function initSidebarNav(): void {
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

async function loadGeneralSettings(): Promise<void> {
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
// Save Only / Test Only Handlers
// ============================================================================

async function handleSaveOnly(): Promise<void> {
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

async function handleTestObsidian(): Promise<void> {
  if (!testObsidianBtn) return;

  statusDiv.innerHTML = '';
  statusDiv.className = '';
  statusDiv.textContent = getMessage('testingConnection') || '接続テスト中...';

  testObsidianBtn.disabled = true;
  try {
    const typedApiKey = apiKeyInput?.value?.trim();
    const testResult = await chrome.runtime.sendMessage({
      type: 'TEST_OBSIDIAN',
      payload: typedApiKey
        ? {
            protocol: protocolInput?.value?.trim(),
            port: portInput?.value?.trim(),
            apiKey: typedApiKey,
          }
        : {}  // 空の場合は保存済み設定を使用
    }) as { obsidian?: { success: boolean; message: string } };

    const obsidianResult = testResult?.obsidian || { success: false, message: 'No response' };

    statusDiv.innerHTML = '';

    const obsidianStatus = document.createElement('div');
    obsidianStatus.style.marginBottom = '8px';
    const obsidianLabel = document.createElement('strong');
    obsidianLabel.textContent = 'Obsidian: ';
    obsidianStatus.appendChild(obsidianLabel);
    const obsidianSpan = document.createElement('span');
    if (obsidianResult.success) {
      obsidianSpan.textContent = getMessage('connectionSuccess') || '接続成功';
      obsidianSpan.style.color = STATUS_COLORS.SUCCESS;
    } else {
      obsidianSpan.textContent = obsidianResult.message;
      obsidianSpan.style.color = STATUS_COLORS.ERROR;
    }
    obsidianStatus.appendChild(obsidianSpan);
    statusDiv.appendChild(obsidianStatus);

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

async function handleTestAi(): Promise<void> {
  if (!testAiBtn) return;

  statusDiv.innerHTML = '';
  statusDiv.className = '';
  statusDiv.textContent = getMessage('testingConnection') || '接続テスト中...';

  testAiBtn.disabled = true;
  try {
    const testResult = await chrome.runtime.sendMessage({
      type: 'TEST_AI',
      payload: {}
    }) as { ai?: { success: boolean; message: string } };

    const aiResult = testResult?.ai || { success: false, message: 'No response' };

    statusDiv.innerHTML = '';

    const aiStatus = document.createElement('div');
    aiStatus.style.marginBottom = '8px';
    const aiLabel = document.createElement('strong');
    aiLabel.textContent = 'AI: ';
    aiStatus.appendChild(aiLabel);
    const aiSpan = document.createElement('span');
    if (aiResult.success) {
      aiSpan.textContent = getMessage('connectionSuccess') || '接続成功';
      aiSpan.style.color = STATUS_COLORS.SUCCESS;
    } else {
      aiSpan.textContent = aiResult.message;
      aiSpan.style.color = STATUS_COLORS.ERROR;
    }
    aiStatus.appendChild(aiSpan);
    statusDiv.appendChild(aiStatus);

    statusDiv.className = aiResult.success ? 'success' : 'error';
  } catch (e) {
    statusDiv.textContent = getMessage('testError') || '接続テストに失敗しました。';
    statusDiv.className = 'error';
  } finally {
    testAiBtn.disabled = false;
  }
}

// ============================================================================
// Export / Import
// ============================================================================

const exportSettingsBtn = document.getElementById('exportSettingsBtn') as HTMLButtonElement | null;
const importSettingsBtn = document.getElementById('importSettingsBtn') as HTMLButtonElement | null;
const importFileInput = document.getElementById('importFileInput') as HTMLInputElement | null;

const importConfirmModal = document.getElementById('importConfirmModal') as HTMLElement | null;
const closeImportModalBtn = document.getElementById('closeImportModalBtn') as HTMLButtonElement | null;
const cancelImportBtn = document.getElementById('cancelImportBtn') as HTMLButtonElement | null;
const confirmImportBtn = document.getElementById('confirmImportBtn') as HTMLButtonElement | null;
const importPreview = document.getElementById('importPreview') as HTMLElement | null;

let importTrapId: string | null = null;
let pendingImportData: Settings | null = null;
let pendingImportJson: string | null = null;

exportSettingsBtn?.addEventListener('click', async () => {
  try {
    const settings = await getSettings();
    const isMpEnabled = settings.mp_protection_enabled === true;
    const isMpEncryptOnExport = settings.mp_encrypt_on_export === true;

    if (isMpEnabled && isMpEncryptOnExport) {
      showPasswordAuthModal('export', async (password) => {
        const result = await exportEncryptedSettings(password);
        if (result.success && result.encryptedData) {
          await saveEncryptedExportToFile(result.encryptedData);
          showStatus('exportImportStatus', getMessage('settingsExported'), 'success');
        } else {
          showStatus('exportImportStatus', `${getMessage('exportError')}: ${result.error || 'Unknown error'}`, 'error');
        }
      });
    } else {
      await exportSettings();
      showStatus('exportImportStatus', getMessage('settingsExported'), 'success');
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    showStatus('exportImportStatus', `${getMessage('exportError')}: ${message}`, 'error');
  }
});

importSettingsBtn?.addEventListener('click', () => {
  importFileInput?.click();
});

importFileInput?.addEventListener('change', async (e: Event) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text) as ExportFileData;

    if (isEncryptedExport(parsed)) {
      const settings = await getSettings();
      const isMpRequireOnImport = settings.mp_require_on_import === true;

      const handleEncryptedImport = async (password: string) => {
        const imported = await importEncryptedSettings(text, password);
        if (imported) {
          showStatus('exportImportStatus', getMessage('settingsImported'), 'success');
          await loadGeneralSettings();
          await loadDomainSettings();
          await loadPrivacySettings();
          await loadContentSettings();
          await loadTrustSettings();
        } else {
          showStatus('exportImportStatus', `${getMessage('importError')}: Failed to decrypt or apply settings`, 'error');
        }
      };

      if (isMpRequireOnImport) {
        showPasswordAuthModal('import', handleEncryptedImport);
      } else {
        const warningMsg = getMessage('importPasswordRequired') || 'Master password is required to import encrypted settings.';
        if (confirm(warningMsg)) {
          showPasswordAuthModal('import', handleEncryptedImport);
        }
      }

      if (importFileInput) importFileInput.value = '';
      return;
    }

    if (!validateExportData(parsed)) {
      showStatus('exportImportStatus', getMessage('invalidSettingsFile'), 'error');
      if (importFileInput) importFileInput.value = '';
      return;
    }

    pendingImportData = parsed.settings;
    pendingImportJson = text;
    showImportPreview(parsed);

    if (importConfirmModal) {
      importConfirmModal.classList.remove('hidden');
      importConfirmModal.style.display = 'flex';
      void importConfirmModal.offsetHeight;
      importConfirmModal.classList.add('show');
      importConfirmModal.setAttribute('aria-hidden', 'false');
      importTrapId = focusTrapManager.trap(importConfirmModal, closeImportModal);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    showStatus('exportImportStatus', `${getMessage('importError')}: ${message}`, 'error');
  }
});

function closeImportModal(): void {
  if (importConfirmModal) {
    importConfirmModal.setAttribute('aria-hidden', 'true');
    if (importTrapId) {
      focusTrapManager.release(importTrapId);
      importTrapId = null;
    }
    importConfirmModal.classList.remove('show');
    importConfirmModal.style.display = 'none';
    importConfirmModal.classList.add('hidden');
  }
  pendingImportData = null;
  pendingImportJson = null;
  if (importPreview) importPreview.textContent = '';
}

closeImportModalBtn?.addEventListener('click', closeImportModal);
cancelImportBtn?.addEventListener('click', closeImportModal);

confirmImportBtn?.addEventListener('click', async () => {
  if (!pendingImportJson) { closeImportModal(); return; }
  try {
    const imported = await importSettings(pendingImportJson);
    if (imported) {
      showStatus('exportImportStatus', getMessage('settingsImported'), 'success');
      await loadGeneralSettings();
      await loadDomainSettings();
      await loadPrivacySettings();
          await loadContentSettings();
          await loadTrustSettings();
    } else {
      showStatus('exportImportStatus', `${getMessage('importError')}: Failed to apply settings`, 'error');
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    showStatus('exportImportStatus', `${getMessage('importError')}: ${message}`, 'error');
  }
  closeImportModal();
});

importConfirmModal?.addEventListener('click', (e: MouseEvent) => {
  if (e.target === importConfirmModal) closeImportModal();
});

function showImportPreview(data: SettingsExportData): void {
  if (!importPreview) return;
  interface ImportPreviewSummary {
    version: string;
    exportedAt: string;
    obsidian_protocol?: string;
    obsidian_port?: string;
    ai_provider?: string;
    domain_filter_mode?: string;
    privacy_mode?: string;
    domain_count?: string;
  }
  const summary: ImportPreviewSummary = {
    version: data.version,
    exportedAt: new Date(data.exportedAt).toLocaleString(),
  };
  const s = data.settings;
  summary.obsidian_protocol = s.obsidian_protocol as string;
  summary.obsidian_port = s.obsidian_port as string;
  summary.ai_provider = s.ai_provider as string;
  summary.domain_filter_mode = s.domain_filter_mode as string;
  summary.privacy_mode = s.privacy_mode as string;
  summary.domain_count = String((s.domain_whitelist?.length || 0) + (s.domain_blacklist?.length || 0));
  const summaryMsg = chrome.i18n.getMessage('importPreviewSummary') || 'Summary:';
  const noteMsg = chrome.i18n.getMessage('importPreviewNote') || 'API keys and lists are included.';
  importPreview.textContent = `${summaryMsg}\n${JSON.stringify(summary, null, 2)}\n\n${noteMsg}`;
}

// ============================================================================
// Master Password
// ============================================================================

const masterPasswordEnabled = document.getElementById('masterPasswordEnabled') as HTMLInputElement | null;
const masterPasswordOptions = document.getElementById('masterPasswordOptions') as HTMLElement | null;
const changeMasterPasswordBtn = document.getElementById('changeMasterPassword') as HTMLButtonElement | null;

const passwordModal = document.getElementById('passwordModal') as HTMLElement | null;
const passwordModalTitle = document.getElementById('passwordModalTitle') as HTMLElement | null;
const passwordModalDesc = document.getElementById('passwordModalDesc') as HTMLElement | null;
const masterPasswordInput = document.getElementById('masterPasswordInput') as HTMLInputElement | null;
const masterPasswordConfirm = document.getElementById('masterPasswordConfirm') as HTMLInputElement | null;
const passwordStrengthError = document.getElementById('passwordStrengthError') as HTMLElement | null;
const passwordMatchError = document.getElementById('passwordMatchError') as HTMLElement | null;
const passwordStrengthBar = document.querySelector('#passwordStrength .strength-fill') as HTMLElement | null;
const passwordStrengthText = document.getElementById('passwordStrengthText') as HTMLElement | null;
const confirmPasswordGroup = document.getElementById('confirmPasswordGroup') as HTMLElement | null;
const closePasswordModalBtn = document.getElementById('closePasswordModalBtn') as HTMLButtonElement | null;
const cancelPasswordBtn = document.getElementById('cancelPasswordBtn') as HTMLButtonElement | null;
const savePasswordBtn = document.getElementById('savePasswordBtn') as HTMLButtonElement | null;

const passwordAuthModal = document.getElementById('passwordAuthModal') as HTMLElement | null;
const passwordAuthModalTitle = document.getElementById('passwordAuthModalTitle') as HTMLElement | null;
const passwordAuthModalDesc = document.getElementById('passwordAuthModalDesc') as HTMLElement | null;
const masterPasswordAuthInput = document.getElementById('masterPasswordAuthInput') as HTMLInputElement | null;
const passwordAuthError = document.getElementById('passwordAuthError') as HTMLElement | null;
const closePasswordAuthModalBtn = document.getElementById('closePasswordAuthModalBtn') as HTMLButtonElement | null;
const cancelPasswordAuthBtn = document.getElementById('cancelPasswordAuthBtn') as HTMLButtonElement | null;
const submitPasswordAuthBtn = document.getElementById('submitPasswordAuthBtn') as HTMLButtonElement | null;

let passwordTrapId: string | null = null;
let passwordAuthTrapId: string | null = null;
let passwordModalMode: 'set' | 'change' = 'set';
let pendingPasswordAction: ((password: string) => Promise<void>) | null = null;

function updatePasswordStrength(password: string): void {
  if (!passwordStrengthBar || !passwordStrengthText) return;
  if (!password) {
    passwordStrengthBar.style.width = '0%';
    passwordStrengthBar.className = 'strength-fill';
    passwordStrengthText.textContent = getMessage('passwordStrengthWeak') || 'Weak';
    return;
  }
  const result = calculatePasswordStrength(password);
  passwordStrengthBar.style.width = `${result.score}%`;
  passwordStrengthBar.className = `strength-fill ${result.level}`;
  passwordStrengthText.textContent = getMessage(`passwordStrength${result.level.charAt(0).toUpperCase() + result.level.slice(1)}`) || result.text;
}

function showPasswordModal(mode: 'set' | 'change' = 'set'): void {
  if (!passwordModal) return;
  passwordModalMode = mode;
  const titleKey = mode === 'change' ? 'changeMasterPassword' : 'setMasterPassword';
  if (passwordModalTitle) passwordModalTitle.textContent = getMessage(titleKey);
  if (passwordModalDesc) passwordModalDesc.textContent = getMessage('setMasterPasswordDesc');
  if (mode === 'change' && confirmPasswordGroup) confirmPasswordGroup.classList.remove('hidden');
  if (masterPasswordInput) masterPasswordInput.value = '';
  if (masterPasswordConfirm) {
    masterPasswordConfirm.value = '';
    masterPasswordConfirm.classList.toggle('hidden', mode === 'change');
  }
  if (passwordStrengthError) passwordStrengthError.textContent = '';
  if (passwordMatchError) passwordMatchError.textContent = '';
  updatePasswordStrength('');
  passwordModal.classList.remove('hidden');
  passwordModal.style.display = 'flex';
  void passwordModal.offsetHeight;
  passwordModal.classList.add('show');
  passwordTrapId = focusTrapManager.trap(passwordModal, closePasswordModal);
  masterPasswordInput?.focus();
}

function closePasswordModal(): void {
  if (!passwordModal) return;
  passwordModal.classList.remove('show');
  passwordModal.style.display = 'none';
  passwordModal.classList.add('hidden');
  if (passwordTrapId) { focusTrapManager.release(passwordTrapId); passwordTrapId = null; }
  if (masterPasswordInput) masterPasswordInput.value = '';
  if (masterPasswordConfirm) masterPasswordConfirm.value = '';
  if (passwordStrengthError) passwordStrengthError.textContent = '';
  if (passwordMatchError) passwordMatchError.textContent = '';
  updatePasswordStrength('');
}

async function savePassword(): Promise<void> {
  if (!masterPasswordInput) return;
  const password = masterPasswordInput.value;
  const confirmPasswordValue = masterPasswordConfirm?.value ?? '';

  const requirementError = validatePasswordRequirements(password);
  if (requirementError) {
    if (passwordStrengthError) {
      passwordStrengthError.textContent = getMessage('passwordTooShort') || requirementError;
      passwordStrengthError.classList.add('visible');
    }
    return;
  }

  if (passwordModalMode === 'set') {
    const matchError = validatePasswordMatch(password, confirmPasswordValue);
    if (matchError) {
      if (passwordMatchError) {
        passwordMatchError.textContent = getMessage('passwordMismatch') || matchError;
        passwordMatchError.classList.add('visible');
      }
      return;
    }
  }

  const setStorageFn = async (key: string, value: unknown) => {
    await chrome.storage.local.set({ [key]: value });
  };
  const result = await setMasterPassword(password, setStorageFn);

  if (result.success) {
    showStatus('status', getMessage('passwordSaved') || 'Master password saved successfully.', 'success');
    closePasswordModal();
    if (masterPasswordEnabled) masterPasswordEnabled.checked = true;
    if (masterPasswordOptions) masterPasswordOptions.classList.remove('hidden');
  } else {
    showStatus('status', result.error || 'Failed to save password.', 'error');
  }
}

function showPasswordAuthModal(actionType: 'export' | 'import', action: (password: string) => Promise<void>): void {
  if (!passwordAuthModal) return;
  pendingPasswordAction = action;
  if (masterPasswordAuthInput) masterPasswordAuthInput.value = '';
  if (passwordAuthError) passwordAuthError.textContent = '';
  passwordAuthModal.classList.remove('hidden');
  passwordAuthModal.style.display = 'flex';
  void passwordAuthModal.offsetHeight;
  passwordAuthModal.classList.add('show');
  passwordAuthTrapId = focusTrapManager.trap(passwordAuthModal, closePasswordAuthModal);
  masterPasswordAuthInput?.focus();
}

function closePasswordAuthModal(): void {
  if (!passwordAuthModal) return;
  passwordAuthModal.classList.remove('show');
  passwordAuthModal.style.display = 'none';
  passwordAuthModal.classList.add('hidden');
  if (passwordAuthTrapId) { focusTrapManager.release(passwordAuthTrapId); passwordAuthTrapId = null; }
  if (masterPasswordAuthInput) masterPasswordAuthInput.value = '';
  if (passwordAuthError) passwordAuthError.textContent = '';
  pendingPasswordAction = null;
}

async function authenticatePassword(): Promise<void> {
  if (!masterPasswordAuthInput) return;
  const password = masterPasswordAuthInput.value;
  if (!password) {
    if (passwordAuthError) {
      passwordAuthError.textContent = getMessage('passwordRequired') || 'Please enter your master password.';
      passwordAuthError.classList.add('visible');
    }
    return;
  }
  const getStorageFn = async (keys: string[]) => chrome.storage.local.get(keys);
  const result = await verifyMasterPassword(password, getStorageFn);
  if (result.success) {
    closePasswordAuthModal();
    if (pendingPasswordAction) await pendingPasswordAction(password);
  } else {
    if (passwordAuthError) {
      passwordAuthError.textContent = getMessage('passwordIncorrect') || result.error || 'Incorrect password.';
      passwordAuthError.classList.add('visible');
    }
  }
}

if (masterPasswordEnabled && masterPasswordOptions) {
  masterPasswordEnabled.addEventListener('change', async (e: Event) => {
    const isChecked = (e.target as HTMLInputElement).checked;
    if (isChecked) {
      showPasswordModal('set');
    } else {
      await chrome.storage.local.remove(['master_password_enabled', 'master_password_salt', 'master_password_hash']);
      masterPasswordOptions.classList.add('hidden');
      showStatus('status', getMessage('passwordRemoved') || 'Master password removed.', 'success');
    }
  });
}

changeMasterPasswordBtn?.addEventListener('click', () => {
  showPasswordAuthModal('export', async () => {
    showPasswordModal('change');
  });
});

masterPasswordInput?.addEventListener('input', () => {
  if (masterPasswordInput) updatePasswordStrength(masterPasswordInput.value);
});

closePasswordModalBtn?.addEventListener('click', closePasswordModal);
cancelPasswordBtn?.addEventListener('click', closePasswordModal);
savePasswordBtn?.addEventListener('click', savePassword);
passwordModal?.addEventListener('click', (e: MouseEvent) => {
  if (e.target === passwordModal) closePasswordModal();
});

closePasswordAuthModalBtn?.addEventListener('click', closePasswordAuthModal);
cancelPasswordAuthBtn?.addEventListener('click', closePasswordAuthModal);
submitPasswordAuthBtn?.addEventListener('click', authenticatePassword);
masterPasswordAuthInput?.addEventListener('keypress', (e: KeyboardEvent) => {
  if (e.key === 'Enter') authenticatePassword();
});
passwordAuthModal?.addEventListener('click', (e: MouseEvent) => {
  if (e.target === passwordAuthModal) closePasswordAuthModal();
});

async function loadMasterPasswordSettings(): Promise<void> {
  const isSet = await isMasterPasswordSet(async (keys) => chrome.storage.local.get(keys));
  if (masterPasswordEnabled) masterPasswordEnabled.checked = isSet;
  if (masterPasswordOptions) {
    if (isSet) {
      masterPasswordOptions.classList.remove('hidden');
    } else {
      masterPasswordOptions.classList.add('hidden');
    }
  }
}

// ============================================================================
// Domain Filter Tag UI
// ============================================================================

async function initDomainFilterTagUI(): Promise<void> {
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
      ? (getMessage('domainTagCount') || `${domains.length} 件`)
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

// ============================================================================
// Tags Settings Panel
// ============================================================================

async function initTagsPanel(): Promise<void> {
  const tagSummaryModeInput = document.getElementById('tagSummaryMode') as HTMLInputElement | null;
  const defaultCategoriesList = document.getElementById('defaultCategoriesList') as HTMLElement | null;
  const userCategoriesList = document.getElementById('userCategoriesUserList') as HTMLElement | null;
  const noUserCategoriesMsg = document.getElementById('noUserCategoriesMsg') as HTMLElement | null;
  const newCategoryInput = document.getElementById('newCategoryInput') as HTMLInputElement | null;
  const addCategoryBtn = document.getElementById('addCategoryBtn') as HTMLButtonElement | null;
  const saveTagsBtn = document.getElementById('saveTagsBtn') as HTMLButtonElement | null;
  const userCategoriesListEl = document.getElementById('userCategoriesList') as HTMLElement | null;

  // ユーザーが追加したカテゴリの状態（一時保存）
  let userCategories: string[] = [];

  /**
   * デフォルトカテゴリを表示
   */
  function renderDefaultCategories(): void {
    if (!defaultCategoriesList) return;
    defaultCategoriesList.innerHTML = '';
    DEFAULT_CATEGORIES.forEach(category => {
      const item = document.createElement('button');
      item.className = 'default-category-item category-tag-btn';
      item.textContent = `#${category}`;
      item.title = `「#${category}」の履歴を表示`;
      item.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('navigate-to-tag', { detail: category }));
      });
      defaultCategoriesList.appendChild(item);
    });
  }

  /**
   * ユーザーカテゴリを表示
   */
  function renderUserCategories(): void {
    if (!userCategoriesListEl || !noUserCategoriesMsg) return;

    userCategoriesListEl.innerHTML = '';

    if (userCategories.length === 0) {
      noUserCategoriesMsg.hidden = false;
      return;
    }

    noUserCategoriesMsg.hidden = true;

    userCategories.forEach((category, index) => {
      const item = document.createElement('div');
      item.className = 'user-category-item';

      const nameEl = document.createElement('button');
      nameEl.className = 'user-category-name category-tag-btn';
      nameEl.textContent = `#${category}`;
      nameEl.title = `「#${category}」の履歴を表示`;
      nameEl.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('navigate-to-tag', { detail: category }));
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'user-category-delete';
      deleteBtn.textContent = '×';
      deleteBtn.setAttribute('aria-label', `Delete ${category}`);
      deleteBtn.addEventListener('click', () => {
        userCategories.splice(index, 1);
        renderUserCategories();
      });

      item.appendChild(nameEl);
      item.appendChild(deleteBtn);
      userCategoriesListEl.appendChild(item);
    });
  }

  /**
   * カテゴリを追加
   */
  const MAX_CATEGORY_NAME_LENGTH = 50;
  // タグパース形式（`# tag | summary`）を壊す可能性のある文字を禁止
  const INVALID_CATEGORY_CHARS = /[|#\n\r]/;

  function addCategory(): void {
    if (!newCategoryInput) return;
    const categoryName = newCategoryInput.value.trim();

    if (!categoryName) return;

    // 最大長チェック
    if (categoryName.length > MAX_CATEGORY_NAME_LENGTH) {
      alert(getMessage('categoryNameTooLong') || `カテゴリ名が長すぎます（${MAX_CATEGORY_NAME_LENGTH}文字以内）`);
      return;
    }

    // 禁止文字チェック（|や#はタグパース形式を壊す可能性があるため禁止）
    if (INVALID_CATEGORY_CHARS.test(categoryName)) {
      alert(getMessage('categoryNameInvalidChars') || 'カテゴリ名に使用できない文字が含まれています（|、# は使用不可）');
      return;
    }

    // 重複チェック
    const allCategories = [...DEFAULT_CATEGORIES, ...userCategories];
    if (allCategories.includes(categoryName)) {
      alert(getMessage('duplicateCategoryError') || 'このカテゴリ名は既に存在します');
      return;
    }

    userCategories.push(categoryName);
    newCategoryInput.value = '';
    renderUserCategories();
  }

  /**
   * 設定を保存
   */
  async function saveTagSettings(): Promise<void> {
    const settings = await getSettings();

    // タグ付き要約モード
    settings[StorageKeys.TAG_SUMMARY_MODE] = tagSummaryModeInput?.checked || false;

    // ユーザーカテゴリ
    settings[StorageKeys.TAG_CATEGORIES] = userCategories.map(name => ({
      name,
      isDefault: false,
      createdAt: Date.now()
    }));

    try {
      await saveSettingsWithAllowedUrls(settings);
      showStatus('exportImportStatus', getMessage('tagSettingsSaved') || 'タグ設定を保存しました', 'success');
    } catch (error) {
      console.error('[TagsPanel] Failed to save tag settings:', error);
      showStatus('exportImportStatus', getMessage('saveError') || '保存エラー', 'error');
    }
  }

  /**
   * 設定をロード
   */
  async function loadTagSettings(): Promise<void> {
    const settings = await getSettings();

    // タグ付き要約モード
    if (tagSummaryModeInput) {
      tagSummaryModeInput.checked = settings[StorageKeys.TAG_SUMMARY_MODE] as boolean || false;
    }

    // ユーザーカテゴリ
    const savedUserCategories = (settings[StorageKeys.TAG_CATEGORIES] as TagCategory[] | undefined) || [];
    userCategories = savedUserCategories.filter(c => !c.isDefault).map(c => c.name);
    renderUserCategories();
  }

  // 初期化
  renderDefaultCategories();
  await loadTagSettings();

  // イベントハンドラ
  addCategoryBtn?.addEventListener('click', addCategory);

  newCategoryInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCategory();
    }
  });

  saveTagsBtn?.addEventListener('click', saveTagSettings);
}

// ============================================================================
// Domain Search Panel
// ============================================================================

function initDomainSearchPanel(): void {
  const searchInput = document.getElementById('domainSearchInput') as HTMLInputElement | null;
  const matchesEl = document.getElementById('domainSearchMatches') as HTMLElement | null;
  const checkInput = document.getElementById('domainCheckInput') as HTMLInputElement | null;
  const resultEl = document.getElementById('domainSearchResult') as HTMLElement | null;

  // --- Part 1: Filter list incremental search ---
  async function runFilterSearch(): Promise<void> {
    if (!searchInput || !matchesEl) return;
    const query = searchInput.value.trim().toLowerCase();
    matchesEl.innerHTML = '';

    if (!query) return;

    const settings = await getSettings();
    const blacklist: string[] = (settings[StorageKeys.DOMAIN_BLACKLIST as keyof Settings] as string[]) || [];
    const whitelist: string[] = (settings[StorageKeys.DOMAIN_WHITELIST as keyof Settings] as string[]) || [];

    const blackMatches = blacklist.filter(d => d.toLowerCase().includes(query));
    const whiteMatches = whitelist.filter(d => d.toLowerCase().includes(query));

    if (blackMatches.length === 0 && whiteMatches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'domain-match-empty';
      empty.textContent = getMessage('domainNoMatches') || 'No matching rules found.';
      matchesEl.appendChild(empty);
      return;
    }

    function renderGroup(items: string[], listType: 'blacklist' | 'whitelist'): void {
      if (items.length === 0) return;
      const label = listType === 'blacklist'
        ? (getMessage('blacklistLabel') || 'Blacklist')
        : (getMessage('whitelistLabel') || 'Whitelist');
      const header = document.createElement('div');
      header.className = `domain-match-group-header domain-match-group-${listType}`;
      header.textContent = `${label} (${items.length})`;
      matchesEl!.appendChild(header);

      items.forEach(domain => {
        const row = document.createElement('div');
        row.className = `domain-match-row domain-match-${listType}`;
        // Highlight matched part
        const idx = domain.toLowerCase().indexOf(query);
        if (idx >= 0) {
          row.innerHTML =
            escapeHtml(domain.slice(0, idx)) +
            `<mark class="domain-match-highlight">${escapeHtml(domain.slice(idx, idx + query.length))}</mark>` +
            escapeHtml(domain.slice(idx + query.length));
        } else {
          row.textContent = domain;
        }
        matchesEl!.appendChild(row);
      });
    }

    renderGroup(blackMatches, 'blacklist');
    renderGroup(whiteMatches, 'whitelist');
  }

  function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  searchInput?.addEventListener('input', runFilterSearch);

  // --- Part 2: URL allowed/blocked check ---
  async function runCheck(): Promise<void> {
    if (!checkInput || !resultEl) return;
    const value = checkInput.value.trim();
    if (!value) {
      resultEl.className = 'domain-search-result';
      resultEl.textContent = '';
      return;
    }

    resultEl.className = 'domain-search-result visible info';
    resultEl.textContent = getMessage('checking') || 'Checking...';

    try {
      const url = value.startsWith('http') ? value : `https://${value}`;
      const allowed = await isDomainAllowed(url);
      const domain = extractDomain(url) || value;

      if (allowed) {
        resultEl.className = 'domain-search-result visible allowed';
        resultEl.textContent = `✓ ${domain} — ${getMessage('domainAllowed') || 'Allowed (will be recorded)'}`;
      } else {
        resultEl.className = 'domain-search-result visible blocked';
        resultEl.textContent = `✗ ${domain} — ${getMessage('domainBlocked') || 'Blocked (will not be recorded)'}`;
      }
    } catch (e) {
      resultEl.className = 'domain-search-result visible info';
      resultEl.textContent = getMessage('checkError') || 'Error checking domain.';
    }
  }

  checkInput?.addEventListener('input', runCheck);
}

// ============================================================================
// Diagnostics Panel
// ============================================================================

async function initDiagnosticsPanel(): Promise<void> {
  const storageStats = document.getElementById('diagStorageStats') as HTMLElement | null;
  const extInfo = document.getElementById('diagExtInfo') as HTMLElement | null;
  const diagTestObsidianBtn = document.getElementById('diagTestObsidianBtn') as HTMLButtonElement | null;
  const diagTestAiBtn = document.getElementById('diagTestAiBtn') as HTMLButtonElement | null;
  const connectionResult = document.getElementById('diagConnectionResult') as HTMLElement | null;
  const obsidianSettingsEl = document.getElementById('diagObsidianSettings') as HTMLElement | null;
  const aiSettingsEl = document.getElementById('diagAiSettings') as HTMLElement | null;

  function makeStatRow(label: string, value: string, masked = false): HTMLElement {
    const row = document.createElement('div');
    row.className = 'diag-stat-row';
    const valueHtml = masked
      ? `<span class="diag-stat-value diag-stat-masked">${value}</span>`
      : `<span class="diag-stat-value">${value}</span>`;
    row.innerHTML = `<span class="diag-stat-label">${label}</span>${valueHtml}`;
    return row;
  }

  // Obsidian / AI 設定情報
  try {
    const settings = await getSettings();

    if (obsidianSettingsEl) {
      const protocol = (settings[StorageKeys.OBSIDIAN_PROTOCOL] as string) || 'https';
      const port = (settings[StorageKeys.OBSIDIAN_PORT] as string) || '27124';
      const apiKey = (settings[StorageKeys.OBSIDIAN_API_KEY] as string) || '';
      const dailyPath = (settings[StorageKeys.OBSIDIAN_DAILY_PATH] as string) || '';

      obsidianSettingsEl.appendChild(makeStatRow(
        getMessage('diagProtocol') || 'Protocol',
        protocol
      ));
      obsidianSettingsEl.appendChild(makeStatRow(
        getMessage('diagPort') || 'Port',
        port
      ));
      obsidianSettingsEl.appendChild(makeStatRow(
        getMessage('diagRestUrl') || 'REST API URL',
        `${protocol}://127.0.0.1:${port}`
      ));
      obsidianSettingsEl.appendChild(makeStatRow(
        getMessage('diagDailyPath') || 'Daily Note Path',
        dailyPath || (getMessage('defaultValue') || '(default)')
      ));
      const configuredLabel = getMessage('configured') || '(configured)';
      const notSetLabel = getMessage('notSet') || '(not set)';
      obsidianSettingsEl.appendChild(makeStatRow(
        getMessage('diagApiKey') || 'API Key',
        apiKey ? `${'•'.repeat(8)} ${configuredLabel}` : notSetLabel,
        !apiKey
      ));
    }

    if (aiSettingsEl) {
      const provider = (settings[StorageKeys.AI_PROVIDER] as string) || 'gemini';
      const providerLabels: Record<string, string> = {
        gemini: 'Google Gemini',
        openai: 'OpenAI Compatible',
        openai2: 'OpenAI Compatible 2',
      };
      aiSettingsEl.appendChild(makeStatRow(
        getMessage('diagProvider') || 'Provider',
        providerLabels[provider] || provider
      ));

      const configuredLabel = getMessage('configured') || '(configured)';
      const notSetLabel = getMessage('notSet') || '(not set)';

      if (provider === 'gemini') {
        const model = (settings[StorageKeys.GEMINI_MODEL] as string) || '';
        const key = (settings[StorageKeys.GEMINI_API_KEY] as string) || '';
        aiSettingsEl.appendChild(makeStatRow(
          getMessage('diagModel') || 'Model',
          model || notSetLabel
        ));
        aiSettingsEl.appendChild(makeStatRow(
          getMessage('diagApiKey') || 'API Key',
          key ? `${'•'.repeat(8)} ${configuredLabel}` : notSetLabel,
          !key
        ));
      } else if (provider === 'openai') {
        const baseUrl = (settings[StorageKeys.OPENAI_BASE_URL] as string) || '';
        const model = (settings[StorageKeys.OPENAI_MODEL] as string) || '';
        const key = (settings[StorageKeys.OPENAI_API_KEY] as string) || '';
        aiSettingsEl.appendChild(makeStatRow(
          getMessage('diagBaseUrl') || 'Base URL',
          baseUrl || notSetLabel
        ));
        aiSettingsEl.appendChild(makeStatRow(
          getMessage('diagModel') || 'Model',
          model || notSetLabel
        ));
        aiSettingsEl.appendChild(makeStatRow(
          getMessage('diagApiKey') || 'API Key',
          key ? `${'•'.repeat(8)} ${configuredLabel}` : notSetLabel,
          !key
        ));
      } else if (provider === 'openai2') {
        const baseUrl = (settings[StorageKeys.OPENAI_2_BASE_URL] as string) || '';
        const model = (settings[StorageKeys.OPENAI_2_MODEL] as string) || '';
        const key = (settings[StorageKeys.OPENAI_2_API_KEY] as string) || '';
        aiSettingsEl.appendChild(makeStatRow(
          getMessage('diagBaseUrl') || 'Base URL',
          baseUrl || notSetLabel
        ));
        aiSettingsEl.appendChild(makeStatRow(
          getMessage('diagModel') || 'Model',
          model || notSetLabel
        ));
        aiSettingsEl.appendChild(makeStatRow(
          getMessage('diagApiKey') || 'API Key',
          key ? `${'•'.repeat(8)} ${configuredLabel}` : notSetLabel,
          !key
        ));
      }
    }
  } catch {
    obsidianSettingsEl && (obsidianSettingsEl.textContent = getMessage('diagLoadError') || '設定の読み込みに失敗しました。');
  }

  // Storage stats
  if (storageStats) {
    try {
      const bytesUsed = await chrome.storage.local.getBytesInUse(null);
      const kb = (bytesUsed / 1024).toFixed(1);
      const urlCount = await getSavedUrlCount();

      storageStats.appendChild(makeStatRow(
        getMessage('diagStorageUsed') || 'Storage Used',
        `${kb} KB`
      ));
      storageStats.appendChild(makeStatRow(
        getMessage('diagSavedUrls') || 'Saved URLs',
        String(urlCount)
      ));
    } catch {
      storageStats.textContent = getMessage('diagLoadError') || 'Failed to load storage info.';
    }
  }

  // Extension info
  if (extInfo) {
    const manifest = chrome.runtime.getManifest();
    extInfo.appendChild(makeStatRow(
      getMessage('diagVersion') || 'Version',
      manifest.version
    ));
    extInfo.appendChild(makeStatRow(
      getMessage('diagExtName') || 'Extension',
      manifest.name
    ));
  }

  // プレースホルダーテキストをdata属性にセット（CSS ::before で表示）
  if (connectionResult) {
    connectionResult.dataset['placeholder'] = getMessage('diagConnectionPlaceholder') || 'Click "Test Connection" to check the Obsidian API connection.';
  }

  // Obsidian 接続テスト
  diagTestObsidianBtn?.addEventListener('click', async () => {
    if (!connectionResult) return;
    diagTestObsidianBtn.disabled = true;
    connectionResult.textContent = getMessage('testing') || 'Testing...';
    connectionResult.className = 'diag-result';

    try {
      const testResult = await chrome.runtime.sendMessage({
        type: 'TEST_OBSIDIAN',
        payload: {}
      }) as { obsidian?: { success: boolean; message: string } };

      const obsidian = testResult?.obsidian;
      connectionResult.textContent = obsidian
        ? `Obsidian: ${obsidian.success ? '✓' : '✗'} ${obsidian.message}`
        : getMessage('testComplete') || 'Test complete.';
      connectionResult.style.color = obsidian?.success ? `var(--color-success, ${UI_COLORS.CSS_SUCCESS_FALLBACK})` : `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
    } catch (e) {
      connectionResult.textContent = getMessage('testError') || 'Connection test failed.';
      connectionResult.style.color = `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
    } finally {
      diagTestObsidianBtn.disabled = false;
    }
  });

  // AI 接続テスト
  diagTestAiBtn?.addEventListener('click', async () => {
    if (!connectionResult) return;
    diagTestAiBtn.disabled = true;
    connectionResult.textContent = getMessage('testing') || 'Testing...';
    connectionResult.className = 'diag-result';

    try {
      const testResult = await chrome.runtime.sendMessage({
        type: 'TEST_AI',
        payload: {}
      }) as { ai?: { success: boolean; message: string } };

      const ai = testResult?.ai;
      connectionResult.textContent = ai
        ? `AI: ${ai.success ? '✓' : '✗'} ${ai.message}`
        : getMessage('testComplete') || 'Test complete.';
      connectionResult.style.color = ai?.success ? `var(--color-success, ${UI_COLORS.CSS_SUCCESS_FALLBACK})` : `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
    } catch (e) {
      connectionResult.textContent = getMessage('testError') || 'Connection test failed.';
      connectionResult.style.color = `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
    } finally {
      diagTestAiBtn.disabled = false;
    }
  });
}

// ============================================================================
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

function setHtmlLangDir(): void {
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
  try { initDomainSearchPanel(); } catch (e) { console.error('[Dashboard] initDomainSearchPanel error:', e); }
  try { await initTagsPanel(); } catch (e) { console.error('[Dashboard] initTagsPanel error:', e); }
  try { await initDiagnosticsPanel(); } catch (e) { console.error('[Dashboard] initDiagnosticsPanel error:', e); }
  try { await showBreakingChangesModal(); } catch (e) { console.error('[Dashboard] showBreakingChangesModal error:', e); }
  try { await initTrancoConsentPanel(); } catch (e) { console.error('[Dashboard] initTrancoConsentPanel error:', e); }

  console.log('[Dashboard] Initialization complete');
})();

// ============================================================================
// Tranco Consent Panel
// ============================================================================

async function initTrancoConsentPanel(): Promise<void> {
  console.log('[Dashboard] Initializing Tranco Consent Panel');

  const currentVersionEl = document.getElementById('trancoCurrentVersion');
  const domainCountEl = document.getElementById('trancoDomainCount');
  const consentStatusEl = document.getElementById('trancoConsentStatus');

  if (!currentVersionEl || !domainCountEl || !consentStatusEl) {
    console.warn('[Dashboard] Tranco UI elements not found');
    return;
  }

  try {
    // Get current Tranco version
    const settings = await getSettings();
    const version = settings[StorageKeys.TRANCO_VERSION] as string | null;
    const domains = settings[StorageKeys.TRANCO_DOMAINS] as string[] || [];

    // Display version info
    if (version) {
      const d = new Date(version);
      currentVersionEl.textContent = d.toLocaleDateString(
        chrome.i18n.getUILanguage() || 'ja-JP',
        { year: 'numeric', month: 'long', day: 'numeric' }
      );
    } else {
      currentVersionEl.textContent = getMessage('trancoStatusNotUpdated');
    }

    domainCountEl.textContent = domains.length.toString();

    // Get consent state
    const consentState = await getTrancoConsentState(version || 'unknown');
    updateConsentUI(consentState);
  } catch (e) {
    console.error('[Dashboard] Error loading Tranco consent state:', e);
    showStatus('trancoUpdateStatus', getMessage('errorLoadTrancoData') || 'Trancoデータの読み込みに失敗しました', 'error');
  }
}

interface TrancoConsentState {
  needsConsent: 'GRANTED' | 'DENIED' | 'PENDING' | 'ALREADY_GRANTED' | 'RETRY_NEEDED';
  grantedVersion: string | null;
  deniedReason: string | null;
  retryDaysRemaining: number | null;
  latestVersion: string;
}

async function getTrancoConsentState(latestVersion: string): Promise<TrancoConsentState> {
  const settings = await getSettings();
  const grantedVersion = settings[StorageKeys.TRANCO_CONSENT_GRANTED] as string | null;
  const deniedReason = settings[StorageKeys.TRANCO_CONSENT_DENIED_REASON] as string | null;
  const deniedTimestamp = settings[StorageKeys.TRANCO_CONSENT_DENIED_TIMESTAMP] as number | null;

  let needsConsent: TrancoConsentState['needsConsent'];

  if (grantedVersion === latestVersion) {
    needsConsent = 'ALREADY_GRANTED';
  } else if (deniedTimestamp) {
    const elapsedDays = (Date.now() - deniedTimestamp) / (1000 * 60 * 60 * 24);
    const retryDaysRemaining = Math.max(0, 30 - Math.ceil(elapsedDays));

    if (retryDaysRemaining > 0) {
      needsConsent = 'DENIED';
    } else {
      needsConsent = 'RETRY_NEEDED';
    }
  } else {
    needsConsent = 'PENDING';
  }

  return {
    needsConsent,
    grantedVersion,
    deniedReason,
    retryDaysRemaining: needsConsent === 'DENIED'
      ? Math.max(0, 30 - Math.ceil((Date.now() - (deniedTimestamp || 0)) / (1000 * 60 * 60 * 24)))
      : null,
    latestVersion
  };
}

function updateConsentUI(state: TrancoConsentState): void {
  const consentStatusEl = document.getElementById('trancoConsentStatus');
  const consentRetryInfoEl = document.getElementById('trancoConsentRetryInfo');
  const consentActionsEl = document.getElementById('trancoConsentActions');

  if (!consentStatusEl) return;

  // Update status badge
  consentStatusEl.textContent = getMessage(`trancoConsentStatus${state.needsConsent}`) || state.needsConsent;
  consentStatusEl.className = `status-badge status-${state.needsConsent.toLowerCase()}`;

  // Update retry info
  if (state.retryDaysRemaining !== null && state.retryDaysRemaining > 0) {
    consentRetryInfoEl!.textContent = getMessage('trancoConsentRetryDaysRemaining')
      ?.replace('{days}', state.retryDaysRemaining.toString()) || `再確認まで ${state.retryDaysRemaining} 日`;
    consentRetryInfoEl!.hidden = false;
  } else {
    consentRetryInfoEl!.hidden = true;
  }

  // Update actions
  if (state.needsConsent === 'PENDING' || state.needsConsent === 'RETRY_NEEDED') {
    const grantBtn = document.createElement('button');
    grantBtn.className = 'btn-primary';
    grantBtn.textContent = getMessage('trancoUpdateModalConfirmLabel') || '同意する';
    grantBtn.addEventListener('click', () => handleTrancoGrant(state.latestVersion));

    const denyBtn = document.createElement('button');
    denyBtn.className = 'btn-secondary';
    denyBtn.textContent = getMessage('trancoUpdateModalDenyLabel') || '拒否する';
    denyBtn.addEventListener('click', () => handleTrancoDeny());

    consentActionsEl!.innerHTML = '';
    consentActionsEl!.appendChild(grantBtn);
    consentActionsEl!.appendChild(denyBtn);
    consentActionsEl!.hidden = false;
  } else {
    consentActionsEl!.hidden = true;
  }
}

async function handleTrancoGrant(version: string): Promise<void> {
  try {
    const settings = await getSettings();

    const updatedSettings = { ...settings };
    updatedSettings[StorageKeys.TRANCO_CONSENT_GRANTED] = version;
    updatedSettings[StorageKeys.TRANCO_CONSENT_DENIED_REASON] = null;
    updatedSettings[StorageKeys.TRANCO_CONSENT_DENIED_TIMESTAMP] = null;

    await saveSettingsWithAllowedUrls(updatedSettings);

    showStatus(
      'trancoStatus',
      getMessage('trancoConsentGranted') || '同意を保存しました',
      'success'
    );

    await initTrancoConsentPanel();
  } catch (e) {
    console.error('[Dashboard] Error granting Tranco consent:', e);
    showStatus(
      'trancoStatus',
      getMessage('errorConsentData') || '同意の保存中にエラーが発生しました',
      'error'
    );
  }
}

async function handleTrancoDeny(): Promise<void> {
  try {
    const settings = await getSettings();

    const updatedSettings = { ...settings };
    updatedSettings[StorageKeys.TRANCO_CONSENT_GRANTED] = null;
    updatedSettings[StorageKeys.TRANCO_CONSENT_DENIED_REASON] = 'deny';
    updatedSettings[StorageKeys.TRANCO_CONSENT_DENIED_TIMESTAMP] = Date.now();

    await saveSettingsWithAllowedUrls(updatedSettings);

    showStatus(
      'trancoStatus',
      getMessage('trancoConsentDenied') || '拒否を保存しました',
      'error'
    );

    await initTrancoConsentPanel();
  } catch (e) {
    console.error('[Dashboard] Error denying Tranco consent:', e);
    showStatus(
      'trancoStatus',
      getMessage('errorConsentData') || '拒否の保存中にエラーが発生しました',
      'error'
    );
  }
}
