/**
 * dashboard.ts
 * ダッシュボードページのメイン初期化モジュール
 * popup.ts の設定ロジックを流用し、フルページダッシュボードとして動作する
 */

import { StorageKeys, getSettings, saveSettingsWithAllowedUrls, Settings } from '../utils/storage.js';
import { init as initDomainFilter, loadDomainSettings } from '../popup/domainFilter.js';
import { init as initPrivacySettings, loadPrivacySettings } from '../popup/privacySettings.js';
import { initCustomPromptManager } from '../popup/customPromptManager.js';
import { loadSettingsToInputs, extractSettingsFromInputs, showStatus } from '../popup/settingsUiHelper.js';
import { clearAllFieldErrors, validateAllFields, ErrorPair } from '../popup/settings/fieldValidation.js';
import { getMessage } from '../popup/i18n.js';
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
import { setupAIProviderChangeListener, updateAIProviderVisibility, AIProviderElements } from '../popup/settings/aiProvider.js';
import { setupAllFieldValidations } from '../popup/settings/fieldValidation.js';
import { focusTrapManager } from '../popup/utils/focusTrap.js';
import { getSavedUrlsWithTimestamps, getSavedUrlEntries, removeSavedUrl, getSavedUrlCount, setUrlTags } from '../utils/storageUrls.js';
import { getPendingPages, removePendingPages } from '../utils/pendingStorage.js';
import { extractDomain, isDomainAllowed } from '../utils/domainUtils.js';
import { DEFAULT_CATEGORIES, getAllCategories } from '../utils/tagUtils.js';
import { ModelsDevDialog } from './models-dev-dialog.js';

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
const openaiCompatibleSettingsDiv = document.getElementById('openai-compatibleSettings') as HTMLElement;

const geminiApiKeyInput = document.getElementById('geminiApiKey') as HTMLInputElement;
const geminiModelInput = document.getElementById('geminiModel') as HTMLInputElement;

const openaiBaseUrlInput = document.getElementById('openaiBaseUrl') as HTMLInputElement;
const openaiApiKeyInput = document.getElementById('openaiApiKey') as HTMLInputElement;
const openaiModelInput = document.getElementById('openaiModel') as HTMLInputElement;

const openai2BaseUrlInput = document.getElementById('openai2BaseUrl') as HTMLInputElement;
const openai2ApiKeyInput = document.getElementById('openai2ApiKey') as HTMLInputElement;
const openai2ModelInput = document.getElementById('openai2Model') as HTMLInputElement;

const providerApiKeyInput = document.getElementById('providerApiKey') as HTMLInputElement;
const providerModelInput = document.getElementById('providerModel') as HTMLInputElement;

const minVisitDurationInput = document.getElementById('minVisitDuration') as HTMLInputElement;
const minScrollDepthInput = document.getElementById('minScrollDepth') as HTMLInputElement;
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
  [StorageKeys.PROVIDER_TYPE]: null,
  [StorageKeys.PROVIDER_BASE_URL]: null,
  [StorageKeys.PROVIDER_API_KEY]: providerApiKeyInput,
  [StorageKeys.PROVIDER_MODEL]: providerModelInput,
  [StorageKeys.MIN_VISIT_DURATION]: minVisitDurationInput,
  [StorageKeys.MIN_SCROLL_DEPTH]: minScrollDepthInput
};

const aiProviderElements: AIProviderElements = {
  select: aiProviderSelect,
  geminiSettings: geminiSettingsDiv,
  openaiSettings: openaiSettingsDiv,
  openai2Settings: openai2SettingsDiv,
  openaiCompatibleSettings: openaiCompatibleSettingsDiv
};

async function loadGeneralSettings(): Promise<void> {
  const settings = await getSettings();
  loadSettingsToInputs(settings, settingsMapping);
  updateAIProviderVisibility(aiProviderElements);

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
    [minScrollDepthInput, 'minScrollDepthError']
  ];
  clearAllFieldErrors(errorPairs);

  if (!validateAllFields(protocolInput, portInput, minVisitDurationInput, minScrollDepthInput)) {
    return;
  }

  const newSettings = extractSettingsFromInputs(settingsMapping);
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
    const testResult = await chrome.runtime.sendMessage({
      type: 'TEST_OBSIDIAN',
      payload: {}
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
      obsidianSpan.style.color = '#2E7D32';
    } else {
      obsidianSpan.textContent = obsidianResult.message;
      obsidianSpan.style.color = '#D32F2F';
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
      aiSpan.style.color = '#2E7D32';
    } else {
      aiSpan.textContent = aiResult.message;
      aiSpan.style.color = '#D32F2F';
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
  } catch (error: any) {
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
  } catch (error: any) {
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
    } else {
      showStatus('exportImportStatus', `${getMessage('importError')}: Failed to apply settings`, 'error');
    }
  } catch (error: any) {
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
  const summary: any = {
    version: data.version,
    exportedAt: new Date(data.exportedAt).toLocaleString(),
  };
  const s = data.settings;
  summary.obsidian_protocol = s.obsidian_protocol;
  summary.obsidian_port = s.obsidian_port;
  summary.ai_provider = s.ai_provider;
  summary.domain_filter_mode = s.domain_filter_mode;
  summary.privacy_mode = s.privacy_mode;
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
// History Panel
// ============================================================================

/**
 * Shows an error message for record operations in the history panel
 * @param info - The info element to append the error to
 * @param error - The error object or message
 */
function showRecordError(info: HTMLElement, error: unknown): void {
  const errorMsg = error instanceof Error 
    ? error.message 
    : (error as { error?: string })?.error 
    || getMessage('recordError') 
    || '記録に失敗しました';
  console.error('[Dashboard] Manual record error:', error);
  const errorEl = document.createElement('div');
  errorEl.className = 'record-error-message';
  errorEl.textContent = errorMsg;
  info.appendChild(errorEl);
  // 5秒後にエラーメッセージを自動消去
  setTimeout(() => { errorEl.remove(); }, 5000);
}

async function initHistoryPanel(): Promise<void> {
  const historySearchInput = document.getElementById('historySearch') as HTMLInputElement | null;
  const historyList = document.getElementById('historyList') as HTMLElement | null;
  const historyStats = document.getElementById('historyStats') as HTMLElement | null;
  const pendingSection = document.getElementById('pendingSection') as HTMLElement | null;
  const pendingList = document.getElementById('pendingList') as HTMLElement | null;
  const filterBtns = document.querySelectorAll<HTMLButtonElement>('.history-filter-btn');

  // タグ編集モーダル要素
  const tagEditModal = document.getElementById('tagEditModal') as HTMLElement | null;
  const closeTagEditModalBtn = document.getElementById('closeTagEditModalBtn') as HTMLButtonElement | null;
  const tagEditUrl = document.getElementById('tagEditUrl') as HTMLElement | null;
  const currentTagsList = document.getElementById('currentTagsList') as HTMLElement | null;
  const noCurrentTagsMsg = document.getElementById('noCurrentTagsMsg') as HTMLElement | null;
  const tagCategorySelect = document.getElementById('tagCategorySelect') as HTMLSelectElement | null;
  const addTagBtn = document.getElementById('addTagBtn') as HTMLButtonElement | null;
  const saveTagEditsBtn = document.getElementById('saveTagEditsBtn') as HTMLButtonElement | null;

  if (!historyList) return;

  // タグ編集モーダルの状態
  let editingUrl: string | null = null;
  let editingTags: string[] = [];
  let tagEditTrapId: string | null = null;

  // 記録済みエントリ（recordType付き）を取得
  const rawEntries = await getSavedUrlEntries();
  // pending URLセットを取得（スキップ表示に使う）
  const pendingPages = await getPendingPages();
  const pendingUrlSet = new Set(pendingPages.map(p => p.url));

  let entries = rawEntries.slice().sort((a, b) => b.timestamp - a.timestamp);

  let activeFilter: 'all' | 'auto' | 'manual' | 'skipped' | 'masked' = 'all';
  let activeTagFilter: string | null = null;  // タグフィルター用
  const HISTORY_PAGE_SIZE = 10;
  let historyCurrentPage = 0;

  // ストレージ変化を監視してリアルタイム更新
  const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local') return;

    const savedChanged = 'savedUrlsWithTimestamps' in changes;
    // pendingPages は chrome.storage.local の独立キー 'osh_pending_pages' に保存される
    const pendingChanged = 'osh_pending_pages' in changes;

    if (!savedChanged && !pendingChanged) return;

    const updatePromises: Promise<void>[] = [];

    if (savedChanged) {
      updatePromises.push(
        getSavedUrlEntries().then(updated => {
          entries = updated.slice().sort((a, b) => b.timestamp - a.timestamp);
        })
      );
    }

    if (pendingChanged) {
      updatePromises.push(
        getPendingPages().then(updated => {
          pendingPages.length = 0;
          pendingPages.push(...updated);
          pendingUrlSet.clear();
          updated.forEach(p => pendingUrlSet.add(p.url));
        })
      );
    }

    Promise.all(updatePromises).then(() => applyFilters());
  };
  chrome.storage.onChanged.addListener(onStorageChanged);

  function makeRecordTypeBadge(recordType?: string): HTMLElement {
    const badge = document.createElement('span');
    if (recordType === 'manual') {
      badge.className = 'history-badge history-badge-manual';
      badge.textContent = getMessage('recordTypeManual') || '手動';
    } else {
      badge.className = 'history-badge history-badge-auto';
      badge.textContent = getMessage('recordTypeAuto') || '自動';
    }
    return badge;
  }

  function makeMaskBadge(maskedCount: number | undefined): HTMLSpanElement | null {
    if (!maskedCount || maskedCount === 0) return null;
    const badge = document.createElement('span');
    badge.className = 'history-badge history-badge-masked';
    const label = getMessage('maskedBadge', { count: String(maskedCount) }) || `🔒 ${maskedCount}`;
    badge.textContent = label;
    badge.title = getMessage('maskedBadgeTitle', { count: String(maskedCount) }) || `${maskedCount}件の個人情報をマスクしてAIに送信しました`;
    return badge;
  }

  /**
   * タグバッジコンテナを作成
   * @param {string[] | undefined} tags - タグ配列
   * @param {string} url - 対象URL（タグクリック時に使用）
   * @returns {HTMLElement | null} タグバッジコンテナ
   */
  function makeTagBadges(tags: string[] | undefined, url: string): HTMLElement | null {
    if (!tags || tags.length === 0) return null;

    const container = document.createElement('div');
    container.className = 'tag-badges';

    tags.forEach(tag => {
      const badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'tag-badge';
      badge.textContent = `#${tag}`;
      badge.setAttribute('aria-label', getMessage('tagFilterAriaLabel', [tag]) || `#${tag}`);

      // アクティブなフィルターと同じタグの場合はハイライト
      const isActive = activeTagFilter === tag;
      if (isActive) {
        badge.classList.add('filter-active');
      }
      badge.setAttribute('aria-pressed', isActive ? 'true' : 'false');

      // タグクリックでフィルター切り替え
      badge.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (activeTagFilter === tag) {
          // 同じタグをクリックした場合はフィルター解除
          activeTagFilter = null;
        } else {
          // 新しいタグでフィルター
          activeTagFilter = tag;
        }
        historyCurrentPage = 0;
        applyFilters(false);
        updateTagFilterIndicator();
      });

      container.appendChild(badge);
    });

    return container;
  }

  /**
   * タグフィルターインジケーターを更新
   */
  function updateTagFilterIndicator(): void {
    // 既存のインジケーターを削除
    const existingIndicator = document.getElementById('tagFilterIndicator');
    if (existingIndicator) {
      existingIndicator.remove();
    }

    // アクティブなタグフィルターがない場合は何もしない
    if (!activeTagFilter) return;

    // 履歴コントロールの後にインジケーターを追加
    const controls = document.querySelector('.history-controls');
    if (!controls) return;

    const indicator = document.createElement('div');
    indicator.id = 'tagFilterIndicator';
    indicator.className = 'tag-filter-indicator';

    const filterLabel = document.createElement('span');
    filterLabel.className = 'tag-filter-label';
    filterLabel.textContent = 'フィルター:';

    const filterValue = document.createElement('span');
    filterValue.className = 'tag-filter-value';
    filterValue.textContent = `#${activeTagFilter}`;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'tag-filter-close';
    closeBtn.title = 'フィルター解除';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => {
      activeTagFilter = null;
      historyCurrentPage = 0;
      applyFilters(false);
      updateTagFilterIndicator();
    });

    indicator.append(filterLabel, filterValue, closeBtn);

    controls.appendChild(indicator);
  }

  function applyFilters(resetPage = true): void {
    if (!historyList) return;

    const searchText = (historySearchInput?.value || '').toLowerCase();

    // フィルター適用: activeFilter が 'skipped' のときは pendingUrlSet から表示
    if (activeFilter === 'skipped') {
      renderSkippedMode(searchText);
      return;
    }

    const filtered = entries.filter(e => {
      const matchesSearch = !searchText || e.url.toLowerCase().includes(searchText);
      const matchesType =
        activeFilter === 'all' ||
        (activeFilter === 'auto' && (!e.recordType || e.recordType === 'auto')) ||
        (activeFilter === 'manual' && e.recordType === 'manual') ||
        (activeFilter === 'masked' && !!e.maskedCount && e.maskedCount > 0);
      // タグフィルター
      const matchesTag = !activeTagFilter || (e.tags && e.tags.includes(activeTagFilter));
      return matchesSearch && matchesType && matchesTag;
    });

    if (resetPage) historyCurrentPage = 0;

    const totalPages = Math.ceil(filtered.length / HISTORY_PAGE_SIZE);
    if (historyCurrentPage >= totalPages && historyCurrentPage > 0) historyCurrentPage = totalPages - 1;

    if (historyStats) {
      historyStats.textContent = `${filtered.length} / ${entries.length}`;
    }

    if (filtered.length === 0) {
      historyList.innerHTML = `<div class="history-empty">${getMessage('historyEmpty') || 'No history found.'}</div>`;
      return;
    }

    const start = historyCurrentPage * HISTORY_PAGE_SIZE;
    const pageItems = filtered.slice(start, start + HISTORY_PAGE_SIZE);

    historyList.innerHTML = '';
    pageItems.forEach(entry => {
      const { url, timestamp, recordType, maskedCount, tags } = entry;
      const row = document.createElement('div');
      row.className = 'history-entry';

      const info = document.createElement('div');
      info.className = 'history-entry-info';

      const topRow = document.createElement('div');
      topRow.className = 'history-entry-top';

      const urlEl = document.createElement('a');
      urlEl.className = 'history-entry-url';
      urlEl.href = url;
      urlEl.target = '_blank';
      urlEl.rel = 'noopener noreferrer';
      urlEl.textContent = url;

      topRow.appendChild(makeRecordTypeBadge(recordType));
      const maskBadge = makeMaskBadge(maskedCount);
      if (maskBadge) topRow.appendChild(maskBadge);
      topRow.appendChild(urlEl);

      const timeEl = document.createElement('div');
      timeEl.className = 'history-entry-time';
      timeEl.textContent = new Date(timestamp).toLocaleString();

      info.appendChild(topRow);
      info.appendChild(timeEl);

      // タグバッジを追加
      const tagBadges = makeTagBadges(tags, url);
      if (tagBadges) {
        info.appendChild(tagBadges);
      } else {
        const noTagRow = document.createElement('div');
        noTagRow.className = 'tag-badges tag-badges-empty';
        const addTagLink = document.createElement('button');
        addTagLink.className = 'tag-add-inline-btn';
        addTagLink.textContent = '+ タグを追加';
        addTagLink.addEventListener('click', () => openTagEditModal(url, []));
        noTagRow.appendChild(addTagLink);
        info.appendChild(noTagRow);
      }

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'history-entry-delete';
      deleteBtn.textContent = '×';
      deleteBtn.setAttribute('aria-label', getMessage('deleteEntry') || 'Delete');
      deleteBtn.addEventListener('click', async () => {
        await removeSavedUrl(url);
        const idx = entries.findIndex(e => e.url === url);
        if (idx !== -1) entries.splice(idx, 1);
        applyFilters(false);
      });

      // タグ編集ボタン
      const editBtn = document.createElement('button');
      editBtn.className = 'history-entry-edit-btn';
      editBtn.textContent = '✎';
      editBtn.setAttribute('aria-label', getMessage('editTags') || 'タグを編集');
      editBtn.title = getMessage('editTags') || 'タグを編集';
      editBtn.addEventListener('click', () => {
        openTagEditModal(url, tags || []);
      });

      row.appendChild(info);
      row.appendChild(editBtn);
      row.appendChild(deleteBtn);
      historyList.appendChild(row);
    });

    // ページネーションコントロール
    if (totalPages > 1) {
      const nav = document.createElement('div');
      nav.className = 'pending-pagination';

      const prevBtn = document.createElement('button');
      prevBtn.className = 'secondary-btn';
      prevBtn.textContent = '←';
      prevBtn.disabled = historyCurrentPage === 0;
      prevBtn.addEventListener('click', () => { historyCurrentPage--; applyFilters(false); });

      const pageInfo = document.createElement('span');
      pageInfo.className = 'pending-page-info';
      pageInfo.textContent = `${historyCurrentPage + 1} / ${totalPages}`;

      const nextBtn = document.createElement('button');
      nextBtn.className = 'secondary-btn';
      nextBtn.textContent = '→';
      nextBtn.disabled = historyCurrentPage >= totalPages - 1;
      nextBtn.addEventListener('click', () => { historyCurrentPage++; applyFilters(false); });

      nav.appendChild(prevBtn);
      nav.appendChild(pageInfo);
      nav.appendChild(nextBtn);
      historyList.appendChild(nav);
    }
  }

  function renderPendingReason(reason: string): string {
    switch (reason) {
      case 'cache-control': return getMessage('pendingReasonCache') || 'Cache-Control ヘッダー';
      case 'set-cookie':    return getMessage('pendingReasonCookie') || 'Set-Cookie ヘッダー';
      case 'authorization': return getMessage('pendingReasonAuth') || 'Authorization ヘッダー';
      default:              return reason;
    }
  }

  function renderSkippedMode(searchText: string): void {
    if (!historyList) return;

    const filtered = pendingPages.filter(p =>
      !searchText ||
      p.url.toLowerCase().includes(searchText) ||
      (p.title || '').toLowerCase().includes(searchText)
    );

    if (historyStats) {
      historyStats.textContent = `${filtered.length} / ${pendingPages.length}`;
    }

    if (filtered.length === 0) {
      historyList.innerHTML = `<div class="history-empty">${getMessage('historyEmpty') || 'No history found.'}</div>`;
      return;
    }

    historyList.innerHTML = '';
    for (const page of filtered) {
      const row = document.createElement('div');
      row.className = 'history-entry pending-entry-inline';

      const info = document.createElement('div');
      info.className = 'history-entry-info';

      const topRow = document.createElement('div');
      topRow.className = 'history-entry-top';

      const skipBadge = document.createElement('span');
      skipBadge.className = 'history-badge history-badge-skipped';
      skipBadge.textContent = getMessage('filterSkipped') || 'スキップ';
      topRow.appendChild(skipBadge);

      const urlEl = document.createElement('a');
      urlEl.className = 'history-entry-url';
      urlEl.href = page.url;
      urlEl.target = '_blank';
      urlEl.rel = 'noopener noreferrer';
      urlEl.textContent = page.title || page.url;
      topRow.appendChild(urlEl);

      const metaEl = document.createElement('div');
      metaEl.className = 'history-entry-time';
      metaEl.textContent = `${new Date(page.timestamp).toLocaleString()} — ${renderPendingReason(page.reason)}`;

      info.appendChild(topRow);
      info.appendChild(metaEl);

      const sendManualRecord = async (skipAi: boolean, btn: HTMLButtonElement): Promise<void> => {
        btn.disabled = true;
        btn.textContent = getMessage('processing') || '処理中...';
        let errorEl = row.querySelector('.record-error-message') as HTMLElement;
        if (errorEl) errorEl.remove();
        try {
          const result = await chrome.runtime.sendMessage({
            type: 'MANUAL_RECORD',
            payload: { title: page.title, url: page.url, content: '', force: true, skipAi }
          });
          if (result?.success) {
            await removePendingPages([page.url]);
            const pIdx = pendingPages.findIndex(p => p.url === page.url);
            if (pIdx !== -1) pendingPages.splice(pIdx, 1);
            pendingUrlSet.delete(page.url);
            row.remove();
            if (historyList.children.length === 0) {
              historyList.innerHTML = `<div class="history-empty">${getMessage('historyEmpty') || 'No history found.'}</div>`;
            }
            if (historyStats) historyStats.textContent = `${pendingPages.length} / ${pendingPages.length}`;
          } else {
            showRecordError(info, result);
            btn.disabled = false;
            btn.textContent = skipAi
              ? (getMessage('recordWithoutAi') || '📝 AI要約なしで記録')
              : (getMessage('recordNow') || '📝 今すぐ記録');
          }
        } catch (error) {
          showRecordError(info, error);
          btn.disabled = false;
          btn.textContent = skipAi
            ? (getMessage('recordWithoutAi') || '📝 AI要約なしで記録')
            : (getMessage('recordNow') || '📝 今すぐ記録');
        }
      };

      const btnGroup = document.createElement('div');
      btnGroup.className = 'pending-btn-group';

      const recordBtn = document.createElement('button');
      recordBtn.className = 'secondary-btn pending-record-btn';
      recordBtn.textContent = getMessage('recordNow') || '📝 今すぐ記録';
      recordBtn.addEventListener('click', () => sendManualRecord(false, recordBtn));

      const recordNoAiBtn = document.createElement('button');
      recordNoAiBtn.className = 'secondary-btn pending-record-btn';
      recordNoAiBtn.textContent = getMessage('recordWithoutAi') || '📝 AI要約なしで記録';
      recordNoAiBtn.addEventListener('click', () => sendManualRecord(true, recordNoAiBtn));

      btnGroup.appendChild(recordBtn);
      btnGroup.appendChild(recordNoAiBtn);

      row.appendChild(info);
      row.appendChild(btnGroup);
      historyList.appendChild(row);
    }
  }

  applyFilters();

  // タグパネルからのナビゲーションイベントを受信
  document.addEventListener('navigate-to-tag', (e: Event) => {
    const tag = (e as CustomEvent<string>).detail;
    activeTagFilter = tag;
    activeFilter = 'all';
    historyCurrentPage = 0;
    // 履歴パネルに切り替え
    document.querySelectorAll<HTMLButtonElement>('.sidebar-nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll<HTMLElement>('.panel').forEach(p => p.classList.remove('active'));
    document.querySelector<HTMLButtonElement>('[data-panel="panel-history"]')?.classList.add('active');
    document.getElementById('panel-history')?.classList.add('active');
    applyFilters(false);
    updateTagFilterIndicator();
  });

  historySearchInput?.addEventListener('input', () => {
    // 検索入力時にタグフィルターをリセット
    activeTagFilter = null;
    updateTagFilterIndicator();
    applyFilters();
  });

  // フィルターボタン
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      activeFilter = (btn.dataset['filter'] || 'all') as typeof activeFilter;
      // タグフィルターをリセット
      activeTagFilter = null;
      updateTagFilterIndicator();
      applyFilters();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 保留中ページ（記録できなかった）セクション — ページ上部の警告ボックス
  // ──────────────────────────────────────────────────────────────────────────
  if (!pendingSection || !pendingList) return;

  if (pendingPages.length === 0) {
    pendingSection.hidden = true;
    return;
  }

  pendingSection.hidden = false;

  // 最新順（timestamp降順）に並べる
  const sortedPending = [...pendingPages].sort((a, b) => b.timestamp - a.timestamp);

  const PENDING_PAGE_SIZE = 10;
  let pendingCurrentPage = 0;

  function renderPendingPage(): void {
    if (!pendingList) return;
    pendingList.innerHTML = '';

    const start = pendingCurrentPage * PENDING_PAGE_SIZE;
    const pageItems = sortedPending.slice(start, start + PENDING_PAGE_SIZE);

    for (const page of pageItems) {
      const row = document.createElement('div');
      row.className = 'pending-entry';

      const info = document.createElement('div');
      info.className = 'pending-entry-info';

      const urlEl = document.createElement('a');
      urlEl.className = 'history-entry-url';
      urlEl.href = page.url;
      urlEl.target = '_blank';
      urlEl.rel = 'noopener noreferrer';
      urlEl.textContent = page.title || page.url;

      const metaEl = document.createElement('div');
      metaEl.className = 'pending-entry-meta';
      metaEl.textContent = `${new Date(page.timestamp).toLocaleString()} — ${renderPendingReason(page.reason)}`;
      if (page.headerValue) {
        const headerEl = document.createElement('span');
        headerEl.className = 'pending-entry-header';
        headerEl.textContent = ` (${page.headerValue})`;
        metaEl.appendChild(headerEl);
      }

      info.appendChild(urlEl);
      info.appendChild(metaEl);

      const btnGroup = document.createElement('div');
      btnGroup.className = 'pending-btn-group';

      const sendPendingRecord = async (skipAi: boolean, btn: HTMLButtonElement): Promise<void> => {
        btn.disabled = true;
        btn.textContent = getMessage('processing') || '処理中...';
        let errorEl = row.querySelector('.record-error-message') as HTMLElement;
        if (errorEl) errorEl.remove();
        try {
          const result = await chrome.runtime.sendMessage({
            type: 'MANUAL_RECORD',
            payload: { title: page.title, url: page.url, content: '', force: true, skipAi }
          });
          if (result?.success) {
            await removePendingPages([page.url]);
            const pIdx = pendingPages.findIndex(p => p.url === page.url);
            if (pIdx !== -1) { pendingPages.splice(pIdx, 1); sortedPending.splice(sortedPending.findIndex(p => p.url === page.url), 1); }
            pendingUrlSet.delete(page.url);
            if (pendingCurrentPage > 0 && pendingCurrentPage * PENDING_PAGE_SIZE >= sortedPending.length) {
              pendingCurrentPage--;
            }
            if (sortedPending.length === 0) {
              pendingSection!.hidden = true;
            } else {
              renderPendingPage();
            }
            if (activeFilter === 'skipped') applyFilters();
          } else {
            showRecordError(info, result);
            btn.disabled = false;
            btn.textContent = skipAi
              ? (getMessage('recordWithoutAi') || '📝 AI要約なしで記録')
              : (getMessage('recordNow') || '📝 今すぐ記録');
          }
        } catch (error) {
          showRecordError(info, error);
          btn.disabled = false;
          btn.textContent = skipAi
            ? (getMessage('recordWithoutAi') || '📝 AI要約なしで記録')
            : (getMessage('recordNow') || '📝 今すぐ記録');
        }
      };

      const recordBtn = document.createElement('button');
      recordBtn.className = 'secondary-btn pending-record-btn';
      recordBtn.textContent = getMessage('recordNow') || '📝 今すぐ記録';
      recordBtn.addEventListener('click', () => sendPendingRecord(false, recordBtn));

      const recordNoAiBtn = document.createElement('button');
      recordNoAiBtn.className = 'secondary-btn pending-record-btn';
      recordNoAiBtn.textContent = getMessage('recordWithoutAi') || '📝 AI要約なしで記録';
      recordNoAiBtn.addEventListener('click', () => sendPendingRecord(true, recordNoAiBtn));

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'danger-btn pending-delete-btn';
      deleteBtn.textContent = getMessage('pendingDeleteForever') || '🗑 完全削除';
      deleteBtn.addEventListener('click', async () => {
        deleteBtn.disabled = true;
        try {
          await removePendingPages([page.url]);
          const pIdx = pendingPages.findIndex(p => p.url === page.url);
          if (pIdx !== -1) pendingPages.splice(pIdx, 1);
          sortedPending.splice(sortedPending.findIndex(p => p.url === page.url), 1);
          pendingUrlSet.delete(page.url);
          if (pendingCurrentPage > 0 && pendingCurrentPage * PENDING_PAGE_SIZE >= sortedPending.length) {
            pendingCurrentPage--;
          }
          if (sortedPending.length === 0) {
            pendingSection!.hidden = true;
          } else {
            renderPendingPage();
          }
          if (activeFilter === 'skipped') applyFilters();
        } catch {
          deleteBtn.disabled = false;
        }
      });

      btnGroup.appendChild(recordBtn);
      btnGroup.appendChild(recordNoAiBtn);
      btnGroup.appendChild(deleteBtn);
      row.appendChild(info);
      row.appendChild(btnGroup);
      pendingList!.appendChild(row);
    }

    // ページネーションコントロール
    const totalPages = Math.ceil(sortedPending.length / PENDING_PAGE_SIZE);
    if (totalPages > 1) {
      const nav = document.createElement('div');
      nav.className = 'pending-pagination';

      const prevBtn = document.createElement('button');
      prevBtn.className = 'secondary-btn';
      prevBtn.textContent = '←';
      prevBtn.disabled = pendingCurrentPage === 0;
      prevBtn.addEventListener('click', () => { pendingCurrentPage--; renderPendingPage(); });

      const pageInfo = document.createElement('span');
      pageInfo.className = 'pending-page-info';
      pageInfo.textContent = `${pendingCurrentPage + 1} / ${totalPages}`;

      const nextBtn = document.createElement('button');
      nextBtn.className = 'secondary-btn';
      nextBtn.textContent = '→';
      nextBtn.disabled = pendingCurrentPage >= totalPages - 1;
      nextBtn.addEventListener('click', () => { pendingCurrentPage++; renderPendingPage(); });

      nav.appendChild(prevBtn);
      nav.appendChild(pageInfo);
      nav.appendChild(nextBtn);
      pendingList!.appendChild(nav);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // タグ編集モーダル
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * タグ編集モーダルを開く
   * @param {string} url - 編集対象URL
   * @param {string[]} currentTags - 現在のタグ
   */
  function openTagEditModal(url: string, currentTags: string[]): void {
    editingUrl = url;
    editingTags = [...currentTags];

    if (tagEditUrl) tagEditUrl.textContent = url;
    renderCurrentTags();
    updateTagCategorySelect();

    if (tagEditModal) {
      tagEditModal.classList.remove('hidden');
      tagEditModal.setAttribute('aria-hidden', 'false');
      tagEditTrapId = focusTrapManager.trap(tagEditModal, closeTagEditModal);
    }
  }

  /**
   * タグ編集モーダルを閉じる
   */
  function closeTagEditModal(): void {
    editingUrl = null;
    editingTags = [];
    if (tagEditTrapId) {
      focusTrapManager.release(tagEditTrapId);
      tagEditTrapId = null;
    }
    if (tagEditModal) {
      tagEditModal.classList.add('hidden');
      tagEditModal.setAttribute('aria-hidden', 'true');
    }
  }

  /**
   * 現在のタグリストをレンダリング
   */
  function renderCurrentTags(): void {
    if (!currentTagsList || !noCurrentTagsMsg) return;

    currentTagsList.innerHTML = '';

    if (editingTags.length === 0) {
      noCurrentTagsMsg.hidden = false;
      return;
    }

    noCurrentTagsMsg.hidden = true;

    editingTags.forEach(tag => {
      const tagItem = document.createElement('span');
      tagItem.className = 'current-tag-item';
      tagItem.textContent = `#${tag}`;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'current-tag-remove';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        editingTags = editingTags.filter(t => t !== tag);
        renderCurrentTags();
        updateTagCategorySelect();
      });

      tagItem.appendChild(removeBtn);
      currentTagsList.appendChild(tagItem);
    });
  }

  /**
   * タグカテゴリセレクトボックスを更新
   */
  async function updateTagCategorySelect(): Promise<void> {
    if (!tagCategorySelect || !addTagBtn) return;

    const settings = await getSettings();
    const categories = getAllCategories(settings);

    // 既存のタグを除外
    const availableCategories = categories.filter(c => !editingTags.includes(c));

    tagCategorySelect.innerHTML = '';
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = getMessage('selectCategory') || 'カテゴリを選択...';
    defaultOption.disabled = true;
    defaultOption.selected = true;
    tagCategorySelect.appendChild(defaultOption);

    availableCategories.forEach(category => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      tagCategorySelect.appendChild(option);
    });

    addTagBtn.disabled = availableCategories.length === 0;
  }

  /**
   * タグを追加
   */
  function addTag(): void {
    if (!tagCategorySelect || !tagCategorySelect.value) return;
    const newTag = tagCategorySelect.value;
    if (!editingTags.includes(newTag)) {
      editingTags.push(newTag);
      renderCurrentTags();
      updateTagCategorySelect();
    }
    tagCategorySelect.value = '';
  }

  /**
   * タグ編集を保存
   */
  async function saveTagEdits(): Promise<void> {
    if (!editingUrl) return;

    try {
      await setUrlTags(editingUrl, editingTags);

      // エントリの更新
      const entryIndex = entries.findIndex(e => e.url === editingUrl);
      if (entryIndex !== -1) {
        entries[entryIndex].tags = editingTags;
      }

      closeTagEditModal();
      applyFilters(false);
    } catch (error) {
      console.error('[Dashboard] Failed to save tags:', error);
      alert(getMessage('saveTagError') || 'タグの保存に失敗しました');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // タグ編集モーダルのイベントハンドラ
  // ─────────────────────────────────────────────────────────────────────────────

  closeTagEditModalBtn?.addEventListener('click', closeTagEditModal);

  tagEditModal?.addEventListener('click', (e) => {
    if (e.target === tagEditModal) {
      closeTagEditModal();
    }
  });

  tagCategorySelect?.addEventListener('change', () => {
    if (addTagBtn) addTagBtn.disabled = !tagCategorySelect.value;
  });

  addTagBtn?.addEventListener('click', addTag);

  saveTagEditsBtn?.addEventListener('click', saveTagEdits);

  renderPendingPage();
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
    const savedUserCategories = settings[StorageKeys.TAG_CATEGORIES] as any[] || [];
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

      obsidianSettingsEl.appendChild(makeStatRow('Protocol', protocol));
      obsidianSettingsEl.appendChild(makeStatRow('Port', port));
      obsidianSettingsEl.appendChild(makeStatRow('REST API URL', `${protocol}://127.0.0.1:${port}`));
      obsidianSettingsEl.appendChild(makeStatRow('Daily Note Path', dailyPath || '(デフォルト)'));
      obsidianSettingsEl.appendChild(makeStatRow('API Key', apiKey ? `${'•'.repeat(8)} (設定済み)` : '(未設定)', !apiKey));
    }

    if (aiSettingsEl) {
      const provider = (settings[StorageKeys.AI_PROVIDER] as string) || 'gemini';
      const providerLabels: Record<string, string> = {
        gemini: 'Google Gemini',
        openai: 'OpenAI Compatible',
        openai2: 'OpenAI Compatible 2',
      };
      aiSettingsEl.appendChild(makeStatRow('Provider', providerLabels[provider] || provider));

      if (provider === 'gemini') {
        const model = (settings[StorageKeys.GEMINI_MODEL] as string) || '';
        const key = (settings[StorageKeys.GEMINI_API_KEY] as string) || '';
        aiSettingsEl.appendChild(makeStatRow('Model', model || '(未設定)'));
        aiSettingsEl.appendChild(makeStatRow('API Key', key ? `${'•'.repeat(8)} (設定済み)` : '(未設定)', !key));
      } else if (provider === 'openai') {
        const baseUrl = (settings[StorageKeys.OPENAI_BASE_URL] as string) || '';
        const model = (settings[StorageKeys.OPENAI_MODEL] as string) || '';
        const key = (settings[StorageKeys.OPENAI_API_KEY] as string) || '';
        aiSettingsEl.appendChild(makeStatRow('Base URL', baseUrl || '(未設定)'));
        aiSettingsEl.appendChild(makeStatRow('Model', model || '(未設定)'));
        aiSettingsEl.appendChild(makeStatRow('API Key', key ? `${'•'.repeat(8)} (設定済み)` : '(未設定)', !key));
      } else if (provider === 'openai2') {
        const baseUrl = (settings[StorageKeys.OPENAI_2_BASE_URL] as string) || '';
        const model = (settings[StorageKeys.OPENAI_2_MODEL] as string) || '';
        const key = (settings[StorageKeys.OPENAI_2_API_KEY] as string) || '';
        aiSettingsEl.appendChild(makeStatRow('Base URL', baseUrl || '(未設定)'));
        aiSettingsEl.appendChild(makeStatRow('Model', model || '(未設定)'));
        aiSettingsEl.appendChild(makeStatRow('API Key', key ? `${'•'.repeat(8)} (設定済み)` : '(未設定)', !key));
      }
    }
  } catch {
    obsidianSettingsEl && (obsidianSettingsEl.textContent = '設定の読み込みに失敗しました。');
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
      connectionResult.style.color = obsidian?.success ? 'var(--color-success, #22c55e)' : 'var(--color-danger, #ef4444)';
    } catch (e) {
      connectionResult.textContent = getMessage('testError') || 'Connection test failed.';
      connectionResult.style.color = 'var(--color-danger, #ef4444)';
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
      connectionResult.style.color = ai?.success ? 'var(--color-success, #22c55e)' : 'var(--color-danger, #ef4444)';
    } catch (e) {
      connectionResult.textContent = getMessage('testError') || 'Connection test failed.';
      connectionResult.style.color = 'var(--color-danger, #ef4444)';
    } finally {
      diagTestAiBtn.disabled = false;
    }
  });
}

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

(async () => {
  console.log('[Dashboard] Starting initialization...');

  try { setHtmlLangDir(); } catch (e) { console.error('[Dashboard] setHtmlLangDir error:', e); }

  initSidebarNav();

  try { initDomainFilter(); } catch (e) { console.error('[Dashboard] initDomainFilter error:', e); }
  try { await initDomainFilterTagUI(); } catch (e) { console.error('[Dashboard] initDomainFilterTagUI error:', e); }
  try { initPrivacySettings(); } catch (e) { console.error('[Dashboard] initPrivacySettings error:', e); }

  try {
    const settings = await getSettings();
    initCustomPromptManager(settings);
  } catch (e) { console.error('[Dashboard] initCustomPromptManager error:', e); }

  try { await loadGeneralSettings(); } catch (e) { console.error('[Dashboard] loadGeneralSettings error:', e); }
  try { await loadMasterPasswordSettings(); } catch (e) { console.error('[Dashboard] loadMasterPasswordSettings error:', e); }

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
  setupAllFieldValidations(protocolInput, portInput, minVisitDurationInput, minScrollDepthInput);

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

  console.log('[Dashboard] Initialization complete');
})();
