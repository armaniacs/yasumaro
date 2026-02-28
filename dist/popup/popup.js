/**
 * popup.ts
 * 設定画面のメイン初期化モジュール
 */
import { StorageKeys, getSettings } from '../utils/storage.js';
import { init as initNavigation } from './navigation.js';
import { init as initDomainFilter, loadDomainSettings } from './domainFilter.js';
import { init as initPrivacySettings, loadPrivacySettings } from './privacySettings.js';
import { initCustomPromptManager } from './customPromptManager.js';
import { loadSettingsToInputs, showStatus } from './settingsUiHelper.js';
import { getMessage } from './i18n.js';
import { exportSettings, importSettings, validateExportData, exportEncryptedSettings, importEncryptedSettings, saveEncryptedExportToFile, isEncryptedExport } from '../utils/settingsExportImport.js';
import { setMasterPassword, verifyMasterPassword, isMasterPasswordSet, calculatePasswordStrength, validatePasswordRequirements, validatePasswordMatch } from '../utils/masterPassword.js';
import { checkRateLimit, recordFailedAttempt, resetFailedAttempts } from '../utils/rateLimiter.js';
import { setupAIProviderChangeListener, updateAIProviderVisibility } from './settings/aiProvider.js';
import { setupAllFieldValidations } from './settings/fieldValidation.js';
import { setupSaveButtonListener } from './settings/settingsSaver.js';
import { focusTrapManager } from './utils/focusTrap.js';
// ============================================================================
// DOM Elements - Settings Form
// ============================================================================
const apiKeyInput = document.getElementById('apiKey');
const protocolInput = document.getElementById('protocol');
const portInput = document.getElementById('port');
const dailyPathInput = document.getElementById('dailyPath');
const aiProviderSelect = document.getElementById('aiProvider');
const geminiSettingsDiv = document.getElementById('geminiSettings');
const openaiSettingsDiv = document.getElementById('openaiSettings');
const openai2SettingsDiv = document.getElementById('openai2Settings');
const geminiApiKeyInput = document.getElementById('geminiApiKey');
const geminiModelInput = document.getElementById('geminiModel');
const openaiBaseUrlInput = document.getElementById('openaiBaseUrl');
const openaiApiKeyInput = document.getElementById('openaiApiKey');
const openaiModelInput = document.getElementById('openaiModel');
const openai2BaseUrlInput = document.getElementById('openai2BaseUrl');
const openai2ApiKeyInput = document.getElementById('openai2ApiKey');
const openai2ModelInput = document.getElementById('openai2Model');
const minVisitDurationInput = document.getElementById('minVisitDuration');
const minScrollDepthInput = document.getElementById('minScrollDepth');
const saveBtn = document.getElementById('save');
const statusDiv = document.getElementById('status');
// Mapping of StorageKeys to DOM elements
const settingsMapping = {
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
const aiProviderElements = {
    select: aiProviderSelect,
    geminiSettings: geminiSettingsDiv,
    openaiSettings: openaiSettingsDiv,
    openai2Settings: openai2SettingsDiv
};
// ============================================================================
// Load Settings
// ============================================================================
async function load() {
    const settings = await getSettings();
    loadSettingsToInputs(settings, settingsMapping);
    updateAIProviderVisibility(aiProviderElements);
}
// ============================================================================
// Field Validation (setup on initialization)
// ============================================================================
const errorPairs = [
    [protocolInput, 'protocolError'],
    [portInput, 'portError'],
    [minVisitDurationInput, 'minVisitDurationError'],
    [minScrollDepthInput, 'minScrollDepthError']
];
// ============================================================================
// Settings Export/Import functionality
// ============================================================================
// Settings menu elements
const settingsMenuBtn = document.getElementById('settingsMenuBtn');
const settingsMenu = document.getElementById('settingsMenu');
const exportSettingsBtn = document.getElementById('exportSettingsBtn');
const importSettingsBtn = document.getElementById('importSettingsBtn');
const importFileInput = document.getElementById('importFileInput');
// Import confirmation modal elements
const importConfirmModal = document.getElementById('importConfirmModal');
const closeImportModalBtn = document.getElementById('closeImportModalBtn');
const cancelImportBtn = document.getElementById('cancelImportBtn');
const confirmImportBtn = document.getElementById('confirmImportBtn');
const importPreview = document.getElementById('importPreview');
// Import modal focus management
let importTrapId = null;
let pendingImportData = null;
let pendingImportJson = null;
// Master Password Modal elements
const masterPasswordEnabled = document.getElementById('masterPasswordEnabled');
const masterPasswordOptions = document.getElementById('masterPasswordOptions');
const changeMasterPasswordBtn = document.getElementById('changeMasterPassword');
// Password Setup Modal elements
const passwordModal = document.getElementById('passwordModal');
const passwordModalTitle = document.getElementById('passwordModalTitle');
const passwordModalDesc = document.getElementById('passwordModalDesc');
const masterPasswordInput = document.getElementById('masterPasswordInput');
const masterPasswordConfirm = document.getElementById('masterPasswordConfirm');
const passwordStrengthError = document.getElementById('passwordStrengthError');
const passwordMatchError = document.getElementById('passwordMatchError');
const passwordStrengthBar = document.querySelector('#passwordStrength .strength-fill');
const passwordStrengthText = document.getElementById('passwordStrengthText');
const confirmPasswordGroup = document.getElementById('confirmPasswordGroup');
const closePasswordModalBtn = document.getElementById('closePasswordModalBtn');
const cancelPasswordBtn = document.getElementById('cancelPasswordBtn');
const savePasswordBtn = document.getElementById('savePasswordBtn');
// Password Auth Modal elements
const passwordAuthModal = document.getElementById('passwordAuthModal');
const passwordAuthModalTitle = document.getElementById('passwordAuthModalTitle');
const passwordAuthModalDesc = document.getElementById('passwordAuthModalDesc');
const masterPasswordAuthInput = document.getElementById('masterPasswordAuthInput');
const passwordAuthError = document.getElementById('passwordAuthError');
const closePasswordAuthModalBtn = document.getElementById('closePasswordAuthModalBtn');
const cancelPasswordAuthBtn = document.getElementById('cancelPasswordAuthBtn');
const submitPasswordAuthBtn = document.getElementById('submitPasswordAuthBtn');
// Password modal focus management
let passwordTrapId = null;
let passwordAuthTrapId = null;
let passwordModalMode = 'set';
let pendingPasswordAction = null;
// Toggle settings menu
if (settingsMenuBtn && settingsMenu) {
    settingsMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        settingsMenu.classList.toggle('hidden');
        settingsMenuBtn.setAttribute('aria-expanded', (!settingsMenu.classList.contains('hidden')).toString());
    });
    document.addEventListener('click', (e) => {
        const target = e.target;
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
                }
                else {
                    showStatus('status', `${getMessage('exportError')}: ${result.error || 'Unknown error'}`, 'error');
                }
            });
        }
        else {
            // 通常のエクスポート（暗号化なし）
            await exportSettings();
            showStatus('status', getMessage('settingsExported'), 'success');
        }
    }
    catch (error) {
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
importFileInput?.addEventListener('change', async (e) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file)
        return;
    try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        // 暗号化されたエクスポートかどうか判定
        if (isEncryptedExport(parsed)) {
            // 暗号化されたエクスポート - パスワード要求
            const settings = await getSettings();
            const isMpRequireOnImport = settings.mp_require_on_import === true;
            const handleEncryptedImport = async (password) => {
                const imported = await importEncryptedSettings(text, password);
                if (imported) {
                    showStatus('status', getMessage('settingsImported'), 'success');
                    await load();
                    await loadDomainSettings();
                    await loadPrivacySettings();
                }
                else {
                    showStatus('status', `${getMessage('importError')}: Failed to decrypt or apply settings`, 'error');
                }
            };
            if (isMpRequireOnImport) {
                showPasswordAuthModal('import', handleEncryptedImport);
            }
            else {
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
    }
    catch (error) {
        console.error('Import error:', error);
        const message = error instanceof Error ? error.message : String(error);
        showStatus('status', `${getMessage('importError')}: ${message}`, 'error');
    }
});
// Close import modal
function closeImportModal() {
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
        }
        else {
            showStatus('status', `${getMessage('importError')}: Failed to apply settings`, 'error');
        }
    }
    catch (error) {
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
importConfirmModal?.addEventListener('click', (e) => {
    if (e.target === importConfirmModal) {
        closeImportModal();
    }
});
// Show import preview (HTML-safe)
function showImportPreview(data) {
    if (!importPreview)
        return;
    const summary = {
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
    summary.domain_count = String((s.domain_whitelist?.length || 0) + (s.domain_blacklist?.length || 0));
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
function updatePasswordStrength(password) {
    if (!passwordStrengthBar || !passwordStrengthText)
        return;
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
function showPasswordModal(mode = 'set') {
    if (!passwordModal)
        return;
    passwordModalMode = mode;
    // モーダルタイトルと説明を更新
    const titleKey = mode === 'change' ? 'changeMasterPassword' : 'setMasterPassword';
    const descKey = mode === 'change' ? 'changeMasterPasswordDesc' : 'setMasterPasswordDesc';
    if (passwordModalTitle)
        passwordModalTitle.textContent = getMessage(titleKey);
    if (passwordModalDesc)
        passwordModalDesc.textContent = getMessage(descKey);
    // 確認入力欄の表示/非表示
    if (mode === 'change' && confirmPasswordGroup) {
        confirmPasswordGroup.classList.remove('hidden');
    }
    // 入力フィールドをクリア
    if (masterPasswordInput)
        masterPasswordInput.value = '';
    if (masterPasswordConfirm) {
        masterPasswordConfirm.value = '';
        masterPasswordConfirm.classList.toggle('hidden', mode === 'change');
    }
    // エラーをクリア
    if (passwordStrengthError)
        passwordStrengthError.textContent = '';
    if (passwordMatchError)
        passwordMatchError.textContent = '';
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
function closePasswordModal() {
    if (!passwordModal)
        return;
    passwordModal.classList.remove('show');
    passwordModal.style.display = 'none';
    passwordModal.classList.add('hidden');
    // フォーカストラップ解放
    if (passwordTrapId) {
        focusTrapManager.release(passwordTrapId);
        passwordTrapId = null;
    }
    // 入力フィールドをクリア
    if (masterPasswordInput)
        masterPasswordInput.value = '';
    if (masterPasswordConfirm)
        masterPasswordConfirm.value = '';
    if (passwordStrengthError)
        passwordStrengthError.textContent = '';
    if (passwordMatchError)
        passwordMatchError.textContent = '';
    // 強度バーをリセット
    updatePasswordStrength('');
}
/**
 * パスワードを保存
 */
async function savePassword() {
    if (!masterPasswordInput)
        return;
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
    const setStorageFn = async (key, value) => {
        await chrome.storage.local.set({ [key]: value });
    };
    const result = await setMasterPassword(password, setStorageFn);
    if (result.success) {
        showStatus('status', getMessage('passwordSaved') || 'Master password saved successfully.', 'success');
        closePasswordModal();
        // UI更新（マスターパスワードが有効になったことを反映）
        if (masterPasswordEnabled)
            masterPasswordEnabled.checked = true;
        if (masterPasswordOptions)
            masterPasswordOptions.classList.remove('hidden');
    }
    else {
        showStatus('status', result.error || 'Failed to save password.', 'error');
    }
}
/**
 * パスワード認証モーダルを表示
 * @param {string} actionType - アクションの種類（\"export\" または \"import\"）
 * @param {() => Promise<void>} action - 認証成功後に実行するアクション
 */
function showPasswordAuthModal(actionType, action) {
    if (!passwordAuthModal)
        return;
    pendingPasswordAction = action;
    // 入力フィールドとエラーをクリア
    if (masterPasswordAuthInput)
        masterPasswordAuthInput.value = '';
    if (passwordAuthError)
        passwordAuthError.textContent = '';
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
function closePasswordAuthModal() {
    if (!passwordAuthModal)
        return;
    passwordAuthModal.classList.remove('show');
    passwordAuthModal.style.display = 'none';
    passwordAuthModal.classList.add('hidden');
    // フォーカストラップ解放
    if (passwordAuthTrapId) {
        focusTrapManager.release(passwordAuthTrapId);
        passwordAuthTrapId = null;
    }
    // 入力フィールドとエラーをクリア
    if (masterPasswordAuthInput)
        masterPasswordAuthInput.value = '';
    if (passwordAuthError)
        passwordAuthError.textContent = '';
    pendingPasswordAction = null;
}
/**
 * 【機能概要】: パスワードを認証
 * 【実装方針】: checkRateLimitでレート制限チェック後、verifyMasterPasswordで認証
 * 【テスト対応】: masterPassword-rateLimit.test.ts - 初回認証成功時、失敗回数が増加しない
 * 🟢 信頼性レベル: 青信号（要件定義書のデータフローベース）
 */
async function authenticatePassword() {
    if (!masterPasswordAuthInput)
        return;
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
    const getStorageFn = async (keys) => {
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
    }
    else {
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
    masterPasswordEnabled.addEventListener('change', async (e) => {
        const isChecked = e.target.checked;
        if (isChecked) {
            // パスワード設定モーダルを表示
            showPasswordModal('set');
        }
        else {
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
    passwordModal.addEventListener('click', (e) => {
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
    masterPasswordAuthInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            authenticatePassword();
        }
    });
}
if (passwordAuthModal) {
    passwordAuthModal.addEventListener('click', (e) => {
        if (e.target === passwordAuthModal) {
            closePasswordAuthModal();
        }
    });
}
// Load Master Password Settings
async function loadMasterPasswordSettings() {
    const isSet = await isMasterPasswordSet(async (keys) => chrome.storage.local.get(keys));
    if (masterPasswordEnabled) {
        masterPasswordEnabled.checked = isSet;
    }
    if (masterPasswordOptions) {
        if (isSet) {
            masterPasswordOptions.classList.remove('hidden');
        }
        else {
            masterPasswordOptions.classList.add('hidden');
        }
    }
}
loadMasterPasswordSettings();
// ============================================================================
// Tab Navigation
// ============================================================================
function initTabNavigation() {
    const tabButtons = document.querySelectorAll('#tabList .tab-btn');
    const tabPanels = document.querySelectorAll('.tab-panel');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetPanelId = btn.getAttribute('aria-controls');
            if (!targetPanelId)
                return;
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
                }
                else {
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
function setHtmlLangDir() {
    const locale = chrome.i18n.getUILanguage();
    const langCode = locale.split('-')[0]; // Extract primary language code (e.g., 'ja' from 'ja-JP')
    document.documentElement.lang = locale;
    // RTL languages (Arabic, Hebrew, Farsi/Persian, Urdu, Kurdish, etc.)
    const rtlLanguages = ['ar', 'he', 'fa', 'ur', 'ku', 'yi', 'dv'];
    if (rtlLanguages.includes(langCode)) {
        document.documentElement.dir = 'rtl';
    }
    else {
        document.documentElement.dir = 'ltr';
    }
}
// Set HTML lang and dir attributes first (before any DOM operations)
try {
    setHtmlLangDir();
}
catch (error) {
    console.error('[Popup] Error setting HTML lang/dir:', error);
}
try {
    initNavigation();
}
catch (error) {
    console.error('[Popup] Error in initNavigation:', error);
}
try {
    initTabNavigation();
}
catch (error) {
    console.error('[Popup] Error in initTabNavigation:', error);
}
try {
    initDomainFilter();
}
catch (error) {
    console.error('[Popup] Error in initDomainFilter:', error);
}
try {
    initPrivacySettings();
}
catch (error) {
    console.error('[Popup] Error in initPrivacySettings:', error);
}
// Load settings and initialize custom prompt manager after other modules
async function initCustomPromptFeature() {
    try {
        const settings = await getSettings();
        initCustomPromptManager(settings);
    }
    catch (error) {
        console.error('[Popup] Error in initCustomPromptManager:', error);
    }
}
initCustomPromptFeature();
try {
    load();
}
catch (error) {
    console.error('[Popup] Error in load:', error);
}
// Setup AI provider change listener
setupAIProviderChangeListener(aiProviderElements);
// Setup field validation listeners
setupAllFieldValidations(protocolInput, portInput, minVisitDurationInput, minScrollDepthInput);
// Setup save button listener
if (saveBtn) {
    setupSaveButtonListener(saveBtn, statusDiv, protocolInput, portInput, minVisitDurationInput, minScrollDepthInput, settingsMapping);
}
;
//# sourceMappingURL=popup.js.map