/**
 * popup.ts
 * 設定画面のメイン初期化モジュール
 */

import { StorageKeys, saveSettingsWithAllowedUrls, getSettings, Settings } from '../utils/storage.js';
import { init as initNavigation } from './navigation.js';
import { init as initDomainFilter, loadDomainSettings } from './domainFilter.js';
import { init as initPrivacySettings, loadPrivacySettings } from './privacySettings.js';
import { initCustomPromptManager } from './customPromptManager.js';
import { loadSettingsToInputs, extractSettingsFromInputs, showStatus } from './settingsUiHelper.js';
import { getMessage } from './i18n.js';
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
    changeMasterPassword,
    isMasterPasswordSet,
    calculatePasswordStrength,
    validatePasswordRequirements,
    validatePasswordMatch
} from '../utils/masterPassword.js';
import {
    checkRateLimit,
    recordFailedAttempt,
    resetFailedAttempts
} from '../utils/rateLimiter.js';

import { setupAIProviderChangeListener, updateAIProviderVisibility, AIProviderElements } from './settings/aiProvider.js';
import {
    validateAllFields,
    setupAllFieldValidations,
    clearAllFieldErrors,
    validateProtocol,
    validatePort,
    validateMinVisitDuration,
    validateMinScrollDepth,
    setFieldError,
    clearFieldError
} from './settings/fieldValidation.js';
import { setupSaveButtonListener } from './settings/settingsSaver.js';
import { focusTrapManager } from './utils/focusTrap.js';

// ============================================================================
// DOM Elements - Settings Form
// ============================================================================

const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const protocolInput = document.getElementById('protocol') as HTMLInputElement;
const portInput = document.getElementById('port') as HTMLInputElement;
const dailyPathInput = document.getElementById('dailyPath') as HTMLInputElement;

const aiProviderSelect = document.getElementById('aiProvider') as HTMLSelectElement;
const geminiSettingsDiv = document.getElementById('geminiSettings') as HTMLElement;
const openaiSettingsDiv = document.getElementById('openaiSettings') as HTMLElement;
const openai2SettingsDiv = document.getElementById('openai2Settings') as HTMLElement;

const geminiApiKeyInput = document.getElementById('geminiApiKey') as HTMLInputElement;
const geminiModelInput = document.getElementById('geminiModel') as HTMLInputElement;

const openaiBaseUrlInput = document.getElementById('openaiBaseUrl') as HTMLInputElement;
const openaiApiKeyInput = document.getElementById('openaiApiKey') as HTMLInputElement;
const openaiModelInput = document.getElementById('openaiModel') as HTMLInputElement;

const openai2BaseUrlInput = document.getElementById('openai2BaseUrl') as HTMLInputElement;
const openai2ApiKeyInput = document.getElementById('openai2ApiKey') as HTMLInputElement;
const openai2ModelInput = document.getElementById('openai2Model') as HTMLInputElement;

const minVisitDurationInput = document.getElementById('minVisitDuration') as HTMLInputElement;
const minScrollDepthInput = document.getElementById('minScrollDepth') as HTMLInputElement;
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const statusDiv = document.getElementById('status') as HTMLElement;

// Mapping of StorageKeys to DOM elements
const settingsMapping: Record<string, HTMLInputElement | HTMLSelectElement> = {
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
    [StorageKeys.MIN_VISIT_DURATION]: minVisitDurationInput,
    [StorageKeys.MIN_SCROLL_DEPTH]: minScrollDepthInput
};

// ============================================================================
// AI Provider UI
// ============================================================================

const aiProviderElements: AIProviderElements = {
    select: aiProviderSelect,
    geminiSettings: geminiSettingsDiv,
    openaiSettings: openaiSettingsDiv,
    openai2Settings: openai2SettingsDiv
};

// ============================================================================
// Load Settings
// ============================================================================

async function load(): Promise<void> {
    const settings = await getSettings();
    loadSettingsToInputs(settings, settingsMapping);
    updateAIProviderVisibility(aiProviderElements);
}

// ============================================================================
// Field Validation (setup on initialization)
// ============================================================================

const errorPairs: [HTMLInputElement, string][] = [
    [protocolInput, 'protocolError'],
    [portInput, 'portError'],
    [minVisitDurationInput, 'minVisitDurationError'],
    [minScrollDepthInput, 'minScrollDepthError']
];

// ============================================================================
// Settings Export/Import functionality
// ============================================================================

// Settings menu elements
const settingsMenuBtn = document.getElementById('settingsMenuBtn') as HTMLButtonElement | null;
const settingsMenu = document.getElementById('settingsMenu') as HTMLElement | null;
const exportSettingsBtn = document.getElementById('exportSettingsBtn') as HTMLButtonElement | null;
const importSettingsBtn = document.getElementById('importSettingsBtn') as HTMLButtonElement | null;
const importFileInput = document.getElementById('importFileInput') as HTMLInputElement | null;

// Import confirmation modal elements
const importConfirmModal = document.getElementById('importConfirmModal') as HTMLElement | null;
const closeImportModalBtn = document.getElementById('closeImportModalBtn') as HTMLButtonElement | null;
const cancelImportBtn = document.getElementById('cancelImportBtn') as HTMLButtonElement | null;
const confirmImportBtn = document.getElementById('confirmImportBtn') as HTMLButtonElement | null;
const importPreview = document.getElementById('importPreview') as HTMLElement | null;

// Import modal focus management
let importTrapId: string | null = null;

let pendingImportData: Settings | null = null;
let pendingImportJson: string | null = null;

// Master Password Modal elements
const masterPasswordEnabled = document.getElementById('masterPasswordEnabled') as HTMLInputElement | null;
const masterPasswordOptions = document.getElementById('masterPasswordOptions') as HTMLElement | null;
const changeMasterPasswordBtn = document.getElementById('changeMasterPassword') as HTMLButtonElement | null;

// Password Setup Modal elements
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

// Password Auth Modal elements
const passwordAuthModal = document.getElementById('passwordAuthModal') as HTMLElement | null;
const passwordAuthModalTitle = document.getElementById('passwordAuthModalTitle') as HTMLElement | null;
const passwordAuthModalDesc = document.getElementById('passwordAuthModalDesc') as HTMLElement | null;
const masterPasswordAuthInput = document.getElementById('masterPasswordAuthInput') as HTMLInputElement | null;
const passwordAuthError = document.getElementById('passwordAuthError') as HTMLElement | null;
const closePasswordAuthModalBtn = document.getElementById('closePasswordAuthModalBtn') as HTMLButtonElement | null;
const cancelPasswordAuthBtn = document.getElementById('cancelPasswordAuthBtn') as HTMLButtonElement | null;
const submitPasswordAuthBtn = document.getElementById('submitPasswordAuthBtn') as HTMLButtonElement | null;

// Password modal focus management
let passwordTrapId: string | null = null;
let passwordAuthTrapId: string | null = null;
let passwordModalMode: 'set' | 'change' = 'set';
let pendingPasswordAction: ((password: string) => Promise<void>) | null = null;

// Toggle settings menu
if (settingsMenuBtn && settingsMenu) {
    settingsMenuBtn.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        settingsMenu.classList.toggle('hidden');
        settingsMenuBtn.setAttribute('aria-expanded',
            (!settingsMenu.classList.contains('hidden')).toString());
    });

    document.addEventListener('click', (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (settingsMenuBtn && !settingsMenuBtn.contains(target) &&
            settingsMenu && !settingsMenu.contains(target)) {
            settingsMenu.classList.add('hidden');
            settingsMenuBtn.setAttribute('aria-expanded', 'false');
        }
    });
}

// Export settings
exportSettingsBtn?.addEventListener('click', async () => {
    settingsMenu?.classList.add('hidden');
    settingsMenuBtn?.setAttribute('aria-expanded', 'false');

    try {
        // マスターパスワード保護オプションを確認
        const settings = await getSettings();
        const isMpEnabled = settings.mp_protection_enabled === true;
        const isMpEncryptOnExport = settings.mp_encrypt_on_export === true;

        if (isMpEnabled && isMpEncryptOnExport) {
            // マスターパスワード認証モーダルを表示してから暗号化エクスポート
            showPasswordAuthModal('export', async (password) => {
                const result = await exportEncryptedSettings(password);
                if (result.success && result.encryptedData) {
                    await saveEncryptedExportToFile(result.encryptedData);
                    showStatus('status', getMessage('settingsExported'), 'success');
                } else {
                    showStatus('status', `${getMessage('exportError')}: ${result.error || 'Unknown error'}`, 'error');
                }
            });
        } else {
            // 通常のエクスポート（暗号化なし）
            await exportSettings();
            showStatus('status', getMessage('settingsExported'), 'success');
        }
    } catch (error: any) {
        console.error('Export error:', error);
        const message = error instanceof Error ? error.message : String(error);
        showStatus('status', `${getMessage('exportError')}: ${message}`, 'error');
    }
});

// Import button click - open file selector
importSettingsBtn?.addEventListener('click', () => {
    settingsMenu?.classList.add('hidden');
    settingsMenuBtn?.setAttribute('aria-expanded', 'false');
    importFileInput?.click();
});

// File selected for import
importFileInput?.addEventListener('change', async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
        const text = await file.text();
        const parsed = JSON.parse(text) as ExportFileData;

        // 暗号化されたエクスポートかどうか判定
        if (isEncryptedExport(parsed)) {
            // 暗号化されたエクスポート - パスワード要求
            const settings = await getSettings();
            const isMpRequireOnImport = settings.mp_require_on_import === true;

            const handleEncryptedImport = async (password: string) => {
                const imported = await importEncryptedSettings(text, password);
                if (imported) {
                    showStatus('status', getMessage('settingsImported'), 'success');
                    await load();
                    await loadDomainSettings();
                    await loadPrivacySettings();
                } else {
                    showStatus('status', `${getMessage('importError')}: Failed to decrypt or apply settings`, 'error');
                }
            };

            if (isMpRequireOnImport) {
                showPasswordAuthModal('import', handleEncryptedImport);
            } else {
                // 警告メッセージを表示してから認証
                const warningMsg = getMessage('importPasswordRequired') || 'Master password is required to import encrypted settings.';
                if (confirm(warningMsg)) {
                    showPasswordAuthModal('import', handleEncryptedImport);
                }
            }

            // 暗号化されたファイルの場合はここで終了
            if (importFileInput) {
                importFileInput.value = '';
            }
            return;
        }

        // 非暗号化エクスポートの処理（既存のロジック）
        if (!validateExportData(parsed)) {
            showStatus('status', getMessage('invalidSettingsFile'), 'error');
            if (importFileInput) {
                importFileInput.value = '';
            }
            return;
        }

        pendingImportData = parsed.settings;
        pendingImportJson = text;

        showImportPreview(parsed);

        if (importConfirmModal) {
            // Show modal
            importConfirmModal.classList.remove('hidden');
            importConfirmModal.style.display = 'flex';
            void importConfirmModal.offsetHeight;
            importConfirmModal.classList.add('show');
            // Update aria-hidden for accessibility (modal is now visible)
            importConfirmModal.setAttribute('aria-hidden', 'false');

            // Set up focus trap with the new manager
            importTrapId = focusTrapManager.trap(importConfirmModal, closeImportModal);
        }

    } catch (error: any) {
        console.error('Import error:', error);
        const message = error instanceof Error ? error.message : String(error);
        showStatus('status', `${getMessage('importError')}: ${message}`, 'error');
    }
});

// Close import modal
function closeImportModal(): void {
    if (importConfirmModal) {
        // Update aria-hidden for accessibility (modal is now hidden)
        importConfirmModal.setAttribute('aria-hidden', 'true');

        // Release focus trap
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
    if (importPreview) {
        importPreview.textContent = '';
    }
}

closeImportModalBtn?.addEventListener('click', closeImportModal);
cancelImportBtn?.addEventListener('click', closeImportModal);

// Confirm import
confirmImportBtn?.addEventListener('click', async () => {
    if (!pendingImportJson) {
        closeImportModal();
        return;
    }

    try {
        const imported = await importSettings(pendingImportJson);
        if (imported) {
            showStatus('status', getMessage('settingsImported'), 'success');
            await load();
            await loadDomainSettings();
            await loadPrivacySettings();
        } else {
            showStatus('status', `${getMessage('importError')}: Failed to apply settings`, 'error');
        }
    } catch (error: any) {
        console.error('Import error:', error);
        const message = error instanceof Error ? error.message : String(error);
        showStatus('status', `${getMessage('importError')}: ${message}`, 'error');
    }

    closeImportModal();
});

// Close modal on escape key (now handled by focus trap)
// document.addEventListener('keydown', (e) => {
//     if (e.key === 'Escape' && !importConfirmModal?.classList.contains('hidden')) {
//         closeImportModal();
//     }
// });

// Close modal when clicking outside
importConfirmModal?.addEventListener('click', (e: MouseEvent) => {
    if (e.target === importConfirmModal) {
        closeImportModal();
    }
});

// Show import preview (HTML-safe)
function showImportPreview(data: SettingsExportData): void {
    if (!importPreview) return;

    const summary: any = {
        version: data.version,
        exportedAt: new Date(data.exportedAt).toLocaleString(),
    };

    const s = data.settings;
    summary.obsidian_protocol = s.obsidian_protocol;
    summary.obsidian_port = s.obsidian_port;
    summary.obsidian_daily_path = s.obsidian_daily_path;
    summary.ai_provider = s.ai_provider;
    summary.gemini_model = s.gemini_model;
    summary.openai_model = s.openai_model;
    summary.openai_2_model = s.openai_2_model;
    summary.min_visit_duration = String(s.min_visit_duration);
    summary.min_scroll_depth = String(s.min_scroll_depth);
    summary.domain_filter_mode = s.domain_filter_mode;
    summary.privacy_mode = s.privacy_mode;
    summary.domain_count = String(
        (s.domain_whitelist?.length || 0) + (s.domain_blacklist?.length || 0)
    );
    summary.ublock_sources_count = String(s.ublock_sources?.length || 0);

    const summaryMsg = chrome.i18n.getMessage('importPreviewSummary') || 'Summary:';
    const noteMsg = chrome.i18n.getMessage('importPreviewNote') || 'Note: Full settings will be applied. API keys and lists are included in the file.';

    importPreview.textContent = `${summaryMsg}\n${JSON.stringify(summary, null, 2)}\n\n${noteMsg}`;
}

// ============================================================================
// Master Password Modal Functions
// ============================================================================

/**
 * パスワード強度を更新
 */
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

/**
 * パスワード設定モーダルを表示
 * @param {'set' | 'change'} mode - モーダルの種類
 */
function showPasswordModal(mode: 'set' | 'change' = 'set'): void {
    if (!passwordModal) return;

    passwordModalMode = mode;

    // モーダルタイトルと説明を更新
    const titleKey = mode === 'change' ? 'changeMasterPassword' : 'setMasterPassword';
    const descKey = mode === 'change' ? 'changeMasterPasswordDesc' : 'setMasterPasswordDesc';
    if (passwordModalTitle) passwordModalTitle.textContent = getMessage(titleKey);
    if (passwordModalDesc) passwordModalDesc.textContent = getMessage(descKey);

    // 確認入力欄の表示/非表示
    if (mode === 'change' && confirmPasswordGroup) {
        confirmPasswordGroup.classList.remove('hidden');
    }

    // 入力フィールドをクリア
    if (masterPasswordInput) masterPasswordInput.value = '';
    if (masterPasswordConfirm) {
        masterPasswordConfirm.value = '';
        masterPasswordConfirm.classList.toggle('hidden', mode === 'change');
    }

    // エラーをクリア
    if (passwordStrengthError) passwordStrengthError.textContent = '';
    if (passwordMatchError) passwordMatchError.textContent = '';

    // 強度バーをリセット
    updatePasswordStrength('');

    // モーダルを表示
    passwordModal.classList.remove('hidden');
    passwordModal.style.display = 'flex';
    void passwordModal.offsetHeight;
    passwordModal.classList.add('show');

    // フォーカストラップ設定
    passwordTrapId = focusTrapManager.trap(passwordModal, closePasswordModal);

    // フォーカスを設定
    masterPasswordInput?.focus();
}

/**
 * パスワード設定モーダルを閉じる
 */
function closePasswordModal(): void {
    if (!passwordModal) return;

    passwordModal.classList.remove('show');
    passwordModal.style.display = 'none';
    passwordModal.classList.add('hidden');

    // フォーカストラップ解放
    if (passwordTrapId) {
        focusTrapManager.release(passwordTrapId);
        passwordTrapId = null;
    }

    // 入力フィールドをクリア
    if (masterPasswordInput) masterPasswordInput.value = '';
    if (masterPasswordConfirm) masterPasswordConfirm.value = '';
    if (passwordStrengthError) passwordStrengthError.textContent = '';
    if (passwordMatchError) passwordMatchError.textContent = '';

    // 強度バーをリセット
    updatePasswordStrength('');
}

/**
 * パスワードを保存
 */
async function savePassword(): Promise<void> {
    if (!masterPasswordInput) return;

    const password = masterPasswordInput.value;
    const confirmPasswordValue = masterPasswordConfirm?.value ?? '';

    // パスワード要件チェック
    const requirementError = validatePasswordRequirements(password);
    if (requirementError) {
        if (passwordStrengthError) {
            passwordStrengthError.textContent = getMessage('passwordTooShort') || requirementError;
            passwordStrengthError.classList.add('visible');
        }
        return;
    }

    // パスワード一致チェック（新しいパスワード設定時のみ）
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

    // パスワード設定
    const setStorageFn = async (key: string, value: unknown) => {
        await chrome.storage.local.set({ [key]: value });
    };

    const result = await setMasterPassword(password, setStorageFn);

    if (result.success) {
        showStatus('status', getMessage('passwordSaved') || 'Master password saved successfully.', 'success');
        closePasswordModal();

        // UI更新（マスターパスワードが有効になったことを反映）
        if (masterPasswordEnabled) masterPasswordEnabled.checked = true;
        if (masterPasswordOptions) masterPasswordOptions.classList.remove('hidden');
    } else {
        showStatus('status', result.error || 'Failed to save password.', 'error');
    }
}

/**
 * パスワード認証モーダルを表示
 * @param {string} actionType - アクションの種類（\"export\" または \"import\"）
 * @param {() => Promise<void>} action - 認証成功後に実行するアクション
 */
function showPasswordAuthModal(actionType: 'export' | 'import', action: (password: string) => Promise<void>): void {
    if (!passwordAuthModal) return;

    pendingPasswordAction = action;

    // 入力フィールドとエラーをクリア
    if (masterPasswordAuthInput) masterPasswordAuthInput.value = '';
    if (passwordAuthError) passwordAuthError.textContent = '';

    // モーダルを表示
    passwordAuthModal.classList.remove('hidden');
    passwordAuthModal.style.display = 'flex';
    void passwordAuthModal.offsetHeight;
    passwordAuthModal.classList.add('show');

    // フォーカストラップ設定
    passwordAuthTrapId = focusTrapManager.trap(passwordAuthModal, closePasswordAuthModal);

    // フォーカスを設定
    masterPasswordAuthInput?.focus();
}

/**
 * パスワード認証モーダルを閉じる
 */
function closePasswordAuthModal(): void {
    if (!passwordAuthModal) return;

    passwordAuthModal.classList.remove('show');
    passwordAuthModal.style.display = 'none';
    passwordAuthModal.classList.add('hidden');

    // フォーカストラップ解放
    if (passwordAuthTrapId) {
        focusTrapManager.release(passwordAuthTrapId);
        passwordAuthTrapId = null;
    }

    // 入力フィールドとエラーをクリア
    if (masterPasswordAuthInput) masterPasswordAuthInput.value = '';
    if (passwordAuthError) passwordAuthError.textContent = '';

    pendingPasswordAction = null;
}

/**
 * 【機能概要】: パスワードを認証
 * 【実装方針】: checkRateLimitでレート制限チェック後、verifyMasterPasswordで認証
 * 【テスト対応】: masterPassword-rateLimit.test.ts - 初回認証成功時、失敗回数が増加しない
 * 🟢 信頼性レベル: 青信号（要件定義書のデータフローベース）
 */
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

    // 【セキュリティ強化】レート制限チェック - 認証前に確認
    const rateLimitResult = await checkRateLimit();
    if (!rateLimitResult.success) {
        if (passwordAuthError) {
            passwordAuthError.textContent = rateLimitResult.error || 'Too many attempts.';
            passwordAuthError.classList.add('visible');
        }
        return;
    }

    const getStorageFn = async (keys: string[]) => {
        return chrome.storage.local.get(keys);
    };

    const result = await verifyMasterPassword(password, getStorageFn);

    if (result.success) {
        // 【レート制限リセット】認証成功時に失敗回数をリセット
        await resetFailedAttempts();
        closePasswordAuthModal();
        // 認証成功後にアクションを実行
        if (pendingPasswordAction) {
            await pendingPasswordAction(password);
        }
    } else {
        // 【失敗記録】認証失敗時に失敗回数を記録
        await recordFailedAttempt();
        if (passwordAuthError) {
            passwordAuthError.textContent = getMessage('passwordIncorrect') || result.error || 'Incorrect password.';
            passwordAuthError.classList.add('visible');
        }
    }
}

// Master Password Protection Toggle Handler
if (masterPasswordEnabled && masterPasswordOptions) {
    masterPasswordEnabled.addEventListener('change', async (e: Event) => {
        const isChecked = (e.target as HTMLInputElement).checked;

        if (isChecked) {
            // パスワード設定モーダルを表示
            showPasswordModal('set');
        } else {
            // チェックを一旦元に戻して認証待ち状態にする
            masterPasswordEnabled.checked = true;
            // 認証成功後にのみマスターパスワードを削除
            showPasswordAuthModal('export', async () => {
                await chrome.storage.local.remove([
                    'master_password_enabled',
                    'master_password_salt',
                    'master_password_hash'
                ]);
                masterPasswordEnabled.checked = false;
                masterPasswordOptions.classList.add('hidden');
                showStatus('status', getMessage('passwordRemoved') || 'Master password removed.', 'success');
            });
        }
    });
}

// Change Master Password Button Handler
if (changeMasterPasswordBtn) {
    changeMasterPasswordBtn.addEventListener('click', () => {
        // 既存パスワードを要求してから変更モーダルを表示
        showPasswordAuthModal('export', async () => {
            // 認証成功後に変更モーダルを表示
            showPasswordModal('change');
        });
    });
}

// Password Modal Event Handlers
if (masterPasswordInput) {
    masterPasswordInput.addEventListener('input', () => {
        updatePasswordStrength(masterPasswordInput.value);
    });
}

if (closePasswordModalBtn) {
    closePasswordModalBtn.addEventListener('click', closePasswordModal);
}

if (cancelPasswordBtn) {
    cancelPasswordBtn.addEventListener('click', closePasswordModal);
}

if (savePasswordBtn) {
    savePasswordBtn.addEventListener('click', savePassword);
}

if (passwordModal) {
    passwordModal.addEventListener('click', (e: MouseEvent) => {
        if (e.target === passwordModal) {
            closePasswordModal();
        }
    });
}

// Password Auth Modal Event Handlers
if (closePasswordAuthModalBtn) {
    closePasswordAuthModalBtn.addEventListener('click', closePasswordAuthModal);
}

if (cancelPasswordAuthBtn) {
    cancelPasswordAuthBtn.addEventListener('click', closePasswordAuthModal);
}

if (submitPasswordAuthBtn) {
    submitPasswordAuthBtn.addEventListener('click', authenticatePassword);
}

if (masterPasswordAuthInput) {
    masterPasswordAuthInput.addEventListener('keypress', (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
            authenticatePassword();
        }
    });
}

if (passwordAuthModal) {
    passwordAuthModal.addEventListener('click', (e: MouseEvent) => {
        if (e.target === passwordAuthModal) {
            closePasswordAuthModal();
        }
    });
}

// Load Master Password Settings
async function loadMasterPasswordSettings(): Promise<void> {
    const isSet = await isMasterPasswordSet(async (keys) => chrome.storage.local.get(keys));
    if (masterPasswordEnabled) {
        masterPasswordEnabled.checked = isSet;
    }
    if (masterPasswordOptions) {
        if (isSet) {
            masterPasswordOptions.classList.remove('hidden');
        } else {
            masterPasswordOptions.classList.add('hidden');
        }
    }
}

loadMasterPasswordSettings();

// ============================================================================
// Tab Navigation
// ============================================================================

function initTabNavigation(): void {
    const tabButtons = document.querySelectorAll<HTMLButtonElement>('#tabList .tab-btn');
    const tabPanels = document.querySelectorAll<HTMLElement>('.tab-panel');

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetPanelId = btn.getAttribute('aria-controls');
            if (!targetPanelId) return;

            // Update tab buttons
            tabButtons.forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-selected', 'true');

            // Update panels
            tabPanels.forEach(panel => {
                if (panel.id === targetPanelId) {
                    panel.classList.add('active');
                    panel.removeAttribute('style');
                    panel.setAttribute('aria-hidden', 'false');
                } else {
                    panel.classList.remove('active');
                    panel.removeAttribute('style');
                    panel.setAttribute('aria-hidden', 'true');
                }
            });
        });
    });
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Set HTML lang and dir attributes based on user locale
 */
function setHtmlLangDir(): void {
    const locale = chrome.i18n.getUILanguage();
    const langCode = locale.split('-')[0]; // Extract primary language code (e.g., 'ja' from 'ja-JP')
    document.documentElement.lang = locale;

    // RTL languages (Arabic, Hebrew, Farsi/Persian, Urdu, Kurdish, etc.)
    const rtlLanguages = ['ar', 'he', 'fa', 'ur', 'ku', 'yi', 'dv'];
    if (rtlLanguages.includes(langCode)) {
        document.documentElement.dir = 'rtl';
    } else {
        document.documentElement.dir = 'ltr';
    }

}

// Set HTML lang and dir attributes first (before any DOM operations)
try {
    setHtmlLangDir();
} catch (error) {
    console.error('[Popup] Error setting HTML lang/dir:', error);
}

try {
    initNavigation();
} catch (error) {
    console.error('[Popup] Error in initNavigation:', error);
}

try {
    initTabNavigation();
} catch (error) {
    console.error('[Popup] Error in initTabNavigation:', error);
}

try {
    initDomainFilter();
} catch (error) {
    console.error('[Popup] Error in initDomainFilter:', error);
}

try {
    initPrivacySettings();
} catch (error) {
    console.error('[Popup] Error in initPrivacySettings:', error);
}

// Load settings and initialize custom prompt manager after other modules
async function initCustomPromptFeature(): Promise<void> {
    try {
        const settings = await getSettings();
        initCustomPromptManager(settings);
    } catch (error) {
        console.error('[Popup] Error in initCustomPromptManager:', error);
    }
}
initCustomPromptFeature();

try {
    load();
} catch (error) {
    console.error('[Popup] Error in load:', error);
}

// Setup AI provider change listener
setupAIProviderChangeListener(aiProviderElements);

// Setup field validation listeners
setupAllFieldValidations(
    protocolInput,
    portInput,
    minVisitDurationInput,
    minScrollDepthInput
);

// Setup save button listener
if (saveBtn) {
    setupSaveButtonListener(
        saveBtn,
        statusDiv,
        protocolInput,
        portInput,
        minVisitDurationInput,
        minScrollDepthInput,
        settingsMapping
    );
}

;