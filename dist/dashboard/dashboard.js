/**
 * dashboard.ts
 * ダッシュボードページのメイン初期化モジュール
 * popup.ts の設定ロジックを流用し、フルページダッシュボードとして動作する
 */
import { StorageKeys, getSettings, saveSettingsWithAllowedUrls } from '../utils/storage.js';
import { init as initDomainFilter, loadDomainSettings } from '../popup/domainFilter.js';
import { init as initPrivacySettings, loadPrivacySettings } from '../popup/privacySettings.js';
import { initCustomPromptManager } from '../popup/customPromptManager.js';
import { loadSettingsToInputs, extractSettingsFromInputs, showStatus } from '../popup/settingsUiHelper.js';
import { clearAllFieldErrors, validateAllFields } from '../popup/settings/fieldValidation.js';
import { getMessage } from '../popup/i18n.js';
import { exportSettings, importSettings, validateExportData, exportEncryptedSettings, importEncryptedSettings, saveEncryptedExportToFile, isEncryptedExport } from '../utils/settingsExportImport.js';
import { setMasterPassword, verifyMasterPassword, isMasterPasswordSet, calculatePasswordStrength, validatePasswordRequirements, validatePasswordMatch } from '../utils/masterPassword.js';
import { setupAIProviderChangeListener, updateAIProviderVisibility } from '../popup/settings/aiProvider.js';
import { setupAllFieldValidations } from '../popup/settings/fieldValidation.js';
import { focusTrapManager } from '../popup/utils/focusTrap.js';
import { getSavedUrlEntries, removeSavedUrl, getSavedUrlCount, setUrlTags } from '../utils/storageUrls.js';
import { getPendingPages, removePendingPages } from '../utils/pendingStorage.js';
import { extractDomain, isDomainAllowed } from '../utils/domainUtils.js';
import { DEFAULT_CATEGORIES, getAllCategories } from '../utils/tagUtils.js';
// ============================================================================
// Sidebar Navigation
// ============================================================================
function initSidebarNav() {
    const navBtns = document.querySelectorAll('.sidebar-nav-btn');
    const panels = document.querySelectorAll('.panel');
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetPanelId = btn.getAttribute('data-panel');
            if (!targetPanelId)
                return;
            navBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            panels.forEach(panel => {
                if (panel.id === targetPanelId) {
                    panel.classList.add('active');
                }
                else {
                    panel.classList.remove('active');
                }
            });
        });
    });
}
// ============================================================================
// DOM Elements - General Settings Form
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
const testObsidianBtn = document.getElementById('testObsidianBtn');
const testAiBtn = document.getElementById('testAiBtn');
const statusDiv = document.getElementById('status');
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
const aiProviderElements = {
    select: aiProviderSelect,
    geminiSettings: geminiSettingsDiv,
    openaiSettings: openaiSettingsDiv,
    openai2Settings: openai2SettingsDiv
};
async function loadGeneralSettings() {
    const settings = await getSettings();
    loadSettingsToInputs(settings, settingsMapping);
    updateAIProviderVisibility(aiProviderElements);
}
// ============================================================================
// Save Only / Test Only Handlers
// ============================================================================
async function handleSaveOnly() {
    statusDiv.textContent = '';
    statusDiv.className = '';
    const errorPairs = [
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
async function handleTestObsidian() {
    if (!testObsidianBtn)
        return;
    statusDiv.innerHTML = '';
    statusDiv.className = '';
    statusDiv.textContent = getMessage('testingConnection') || '接続テスト中...';
    testObsidianBtn.disabled = true;
    try {
        const testResult = await chrome.runtime.sendMessage({
            type: 'TEST_OBSIDIAN',
            payload: {}
        });
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
        }
        else {
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
    }
    catch (e) {
        statusDiv.textContent = getMessage('testError') || '接続テストに失敗しました。';
        statusDiv.className = 'error';
    }
    finally {
        testObsidianBtn.disabled = false;
    }
}
async function handleTestAi() {
    if (!testAiBtn)
        return;
    statusDiv.innerHTML = '';
    statusDiv.className = '';
    statusDiv.textContent = getMessage('testingConnection') || '接続テスト中...';
    testAiBtn.disabled = true;
    try {
        const testResult = await chrome.runtime.sendMessage({
            type: 'TEST_AI',
            payload: {}
        });
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
        }
        else {
            aiSpan.textContent = aiResult.message;
            aiSpan.style.color = '#D32F2F';
        }
        aiStatus.appendChild(aiSpan);
        statusDiv.appendChild(aiStatus);
        statusDiv.className = aiResult.success ? 'success' : 'error';
    }
    catch (e) {
        statusDiv.textContent = getMessage('testError') || '接続テストに失敗しました。';
        statusDiv.className = 'error';
    }
    finally {
        testAiBtn.disabled = false;
    }
}
// ============================================================================
// Export / Import
// ============================================================================
const exportSettingsBtn = document.getElementById('exportSettingsBtn');
const importSettingsBtn = document.getElementById('importSettingsBtn');
const importFileInput = document.getElementById('importFileInput');
const importConfirmModal = document.getElementById('importConfirmModal');
const closeImportModalBtn = document.getElementById('closeImportModalBtn');
const cancelImportBtn = document.getElementById('cancelImportBtn');
const confirmImportBtn = document.getElementById('confirmImportBtn');
const importPreview = document.getElementById('importPreview');
let importTrapId = null;
let pendingImportData = null;
let pendingImportJson = null;
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
                }
                else {
                    showStatus('exportImportStatus', `${getMessage('exportError')}: ${result.error || 'Unknown error'}`, 'error');
                }
            });
        }
        else {
            await exportSettings();
            showStatus('exportImportStatus', getMessage('settingsExported'), 'success');
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        showStatus('exportImportStatus', `${getMessage('exportError')}: ${message}`, 'error');
    }
});
importSettingsBtn?.addEventListener('click', () => {
    importFileInput?.click();
});
importFileInput?.addEventListener('change', async (e) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file)
        return;
    try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (isEncryptedExport(parsed)) {
            const settings = await getSettings();
            const isMpRequireOnImport = settings.mp_require_on_import === true;
            const handleEncryptedImport = async (password) => {
                const imported = await importEncryptedSettings(text, password);
                if (imported) {
                    showStatus('exportImportStatus', getMessage('settingsImported'), 'success');
                    await loadGeneralSettings();
                    await loadDomainSettings();
                    await loadPrivacySettings();
                }
                else {
                    showStatus('exportImportStatus', `${getMessage('importError')}: Failed to decrypt or apply settings`, 'error');
                }
            };
            if (isMpRequireOnImport) {
                showPasswordAuthModal('import', handleEncryptedImport);
            }
            else {
                const warningMsg = getMessage('importPasswordRequired') || 'Master password is required to import encrypted settings.';
                if (confirm(warningMsg)) {
                    showPasswordAuthModal('import', handleEncryptedImport);
                }
            }
            if (importFileInput)
                importFileInput.value = '';
            return;
        }
        if (!validateExportData(parsed)) {
            showStatus('exportImportStatus', getMessage('invalidSettingsFile'), 'error');
            if (importFileInput)
                importFileInput.value = '';
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
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        showStatus('exportImportStatus', `${getMessage('importError')}: ${message}`, 'error');
    }
});
function closeImportModal() {
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
    if (importPreview)
        importPreview.textContent = '';
}
closeImportModalBtn?.addEventListener('click', closeImportModal);
cancelImportBtn?.addEventListener('click', closeImportModal);
confirmImportBtn?.addEventListener('click', async () => {
    if (!pendingImportJson) {
        closeImportModal();
        return;
    }
    try {
        const imported = await importSettings(pendingImportJson);
        if (imported) {
            showStatus('exportImportStatus', getMessage('settingsImported'), 'success');
            await loadGeneralSettings();
            await loadDomainSettings();
            await loadPrivacySettings();
        }
        else {
            showStatus('exportImportStatus', `${getMessage('importError')}: Failed to apply settings`, 'error');
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        showStatus('exportImportStatus', `${getMessage('importError')}: ${message}`, 'error');
    }
    closeImportModal();
});
importConfirmModal?.addEventListener('click', (e) => {
    if (e.target === importConfirmModal)
        closeImportModal();
});
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
const masterPasswordEnabled = document.getElementById('masterPasswordEnabled');
const masterPasswordOptions = document.getElementById('masterPasswordOptions');
const changeMasterPasswordBtn = document.getElementById('changeMasterPassword');
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
const passwordAuthModal = document.getElementById('passwordAuthModal');
const passwordAuthModalTitle = document.getElementById('passwordAuthModalTitle');
const passwordAuthModalDesc = document.getElementById('passwordAuthModalDesc');
const masterPasswordAuthInput = document.getElementById('masterPasswordAuthInput');
const passwordAuthError = document.getElementById('passwordAuthError');
const closePasswordAuthModalBtn = document.getElementById('closePasswordAuthModalBtn');
const cancelPasswordAuthBtn = document.getElementById('cancelPasswordAuthBtn');
const submitPasswordAuthBtn = document.getElementById('submitPasswordAuthBtn');
let passwordTrapId = null;
let passwordAuthTrapId = null;
let passwordModalMode = 'set';
let pendingPasswordAction = null;
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
function showPasswordModal(mode = 'set') {
    if (!passwordModal)
        return;
    passwordModalMode = mode;
    const titleKey = mode === 'change' ? 'changeMasterPassword' : 'setMasterPassword';
    if (passwordModalTitle)
        passwordModalTitle.textContent = getMessage(titleKey);
    if (passwordModalDesc)
        passwordModalDesc.textContent = getMessage('setMasterPasswordDesc');
    if (mode === 'change' && confirmPasswordGroup)
        confirmPasswordGroup.classList.remove('hidden');
    if (masterPasswordInput)
        masterPasswordInput.value = '';
    if (masterPasswordConfirm) {
        masterPasswordConfirm.value = '';
        masterPasswordConfirm.classList.toggle('hidden', mode === 'change');
    }
    if (passwordStrengthError)
        passwordStrengthError.textContent = '';
    if (passwordMatchError)
        passwordMatchError.textContent = '';
    updatePasswordStrength('');
    passwordModal.classList.remove('hidden');
    passwordModal.style.display = 'flex';
    void passwordModal.offsetHeight;
    passwordModal.classList.add('show');
    passwordTrapId = focusTrapManager.trap(passwordModal, closePasswordModal);
    masterPasswordInput?.focus();
}
function closePasswordModal() {
    if (!passwordModal)
        return;
    passwordModal.classList.remove('show');
    passwordModal.style.display = 'none';
    passwordModal.classList.add('hidden');
    if (passwordTrapId) {
        focusTrapManager.release(passwordTrapId);
        passwordTrapId = null;
    }
    if (masterPasswordInput)
        masterPasswordInput.value = '';
    if (masterPasswordConfirm)
        masterPasswordConfirm.value = '';
    if (passwordStrengthError)
        passwordStrengthError.textContent = '';
    if (passwordMatchError)
        passwordMatchError.textContent = '';
    updatePasswordStrength('');
}
async function savePassword() {
    if (!masterPasswordInput)
        return;
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
    const setStorageFn = async (key, value) => {
        await chrome.storage.local.set({ [key]: value });
    };
    const result = await setMasterPassword(password, setStorageFn);
    if (result.success) {
        showStatus('status', getMessage('passwordSaved') || 'Master password saved successfully.', 'success');
        closePasswordModal();
        if (masterPasswordEnabled)
            masterPasswordEnabled.checked = true;
        if (masterPasswordOptions)
            masterPasswordOptions.classList.remove('hidden');
    }
    else {
        showStatus('status', result.error || 'Failed to save password.', 'error');
    }
}
function showPasswordAuthModal(actionType, action) {
    if (!passwordAuthModal)
        return;
    pendingPasswordAction = action;
    if (masterPasswordAuthInput)
        masterPasswordAuthInput.value = '';
    if (passwordAuthError)
        passwordAuthError.textContent = '';
    passwordAuthModal.classList.remove('hidden');
    passwordAuthModal.style.display = 'flex';
    void passwordAuthModal.offsetHeight;
    passwordAuthModal.classList.add('show');
    passwordAuthTrapId = focusTrapManager.trap(passwordAuthModal, closePasswordAuthModal);
    masterPasswordAuthInput?.focus();
}
function closePasswordAuthModal() {
    if (!passwordAuthModal)
        return;
    passwordAuthModal.classList.remove('show');
    passwordAuthModal.style.display = 'none';
    passwordAuthModal.classList.add('hidden');
    if (passwordAuthTrapId) {
        focusTrapManager.release(passwordAuthTrapId);
        passwordAuthTrapId = null;
    }
    if (masterPasswordAuthInput)
        masterPasswordAuthInput.value = '';
    if (passwordAuthError)
        passwordAuthError.textContent = '';
    pendingPasswordAction = null;
}
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
    const getStorageFn = async (keys) => chrome.storage.local.get(keys);
    const result = await verifyMasterPassword(password, getStorageFn);
    if (result.success) {
        closePasswordAuthModal();
        if (pendingPasswordAction)
            await pendingPasswordAction(password);
    }
    else {
        if (passwordAuthError) {
            passwordAuthError.textContent = getMessage('passwordIncorrect') || result.error || 'Incorrect password.';
            passwordAuthError.classList.add('visible');
        }
    }
}
if (masterPasswordEnabled && masterPasswordOptions) {
    masterPasswordEnabled.addEventListener('change', async (e) => {
        const isChecked = e.target.checked;
        if (isChecked) {
            showPasswordModal('set');
        }
        else {
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
    if (masterPasswordInput)
        updatePasswordStrength(masterPasswordInput.value);
});
closePasswordModalBtn?.addEventListener('click', closePasswordModal);
cancelPasswordBtn?.addEventListener('click', closePasswordModal);
savePasswordBtn?.addEventListener('click', savePassword);
passwordModal?.addEventListener('click', (e) => {
    if (e.target === passwordModal)
        closePasswordModal();
});
closePasswordAuthModalBtn?.addEventListener('click', closePasswordAuthModal);
cancelPasswordAuthBtn?.addEventListener('click', closePasswordAuthModal);
submitPasswordAuthBtn?.addEventListener('click', authenticatePassword);
masterPasswordAuthInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter')
        authenticatePassword();
});
passwordAuthModal?.addEventListener('click', (e) => {
    if (e.target === passwordAuthModal)
        closePasswordAuthModal();
});
async function loadMasterPasswordSettings() {
    const isSet = await isMasterPasswordSet(async (keys) => chrome.storage.local.get(keys));
    if (masterPasswordEnabled)
        masterPasswordEnabled.checked = isSet;
    if (masterPasswordOptions) {
        if (isSet) {
            masterPasswordOptions.classList.remove('hidden');
        }
        else {
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
function showRecordError(info, error) {
    const errorMsg = error instanceof Error
        ? error.message
        : error?.error
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
async function initHistoryPanel() {
    const historySearchInput = document.getElementById('historySearch');
    const historyList = document.getElementById('historyList');
    const historyStats = document.getElementById('historyStats');
    const pendingSection = document.getElementById('pendingSection');
    const pendingList = document.getElementById('pendingList');
    const filterBtns = document.querySelectorAll('.history-filter-btn');
    // タグ編集モーダル要素
    const tagEditModal = document.getElementById('tagEditModal');
    const closeTagEditModalBtn = document.getElementById('closeTagEditModalBtn');
    const tagEditUrl = document.getElementById('tagEditUrl');
    const currentTagsList = document.getElementById('currentTagsList');
    const noCurrentTagsMsg = document.getElementById('noCurrentTagsMsg');
    const tagCategorySelect = document.getElementById('tagCategorySelect');
    const addTagBtn = document.getElementById('addTagBtn');
    const saveTagEditsBtn = document.getElementById('saveTagEditsBtn');
    if (!historyList)
        return;
    // タグ編集モーダルの状態
    let editingUrl = null;
    let editingTags = [];
    let tagEditTrapId = null;
    // 記録済みエントリ（recordType付き）を取得
    const rawEntries = await getSavedUrlEntries();
    // pending URLセットを取得（スキップ表示に使う）
    const pendingPages = await getPendingPages();
    const pendingUrlSet = new Set(pendingPages.map(p => p.url));
    let entries = rawEntries.slice().sort((a, b) => b.timestamp - a.timestamp);
    let activeFilter = 'all';
    let activeTagFilter = null; // タグフィルター用
    const HISTORY_PAGE_SIZE = 10;
    let historyCurrentPage = 0;
    // ストレージ変化を監視してリアルタイム更新
    const onStorageChanged = (changes, area) => {
        if (area !== 'local')
            return;
        const savedChanged = 'savedUrlsWithTimestamps' in changes;
        // pendingPages は chrome.storage.local の独立キー 'osh_pending_pages' に保存される
        const pendingChanged = 'osh_pending_pages' in changes;
        if (!savedChanged && !pendingChanged)
            return;
        const updatePromises = [];
        if (savedChanged) {
            updatePromises.push(getSavedUrlEntries().then(updated => {
                entries = updated.slice().sort((a, b) => b.timestamp - a.timestamp);
            }));
        }
        if (pendingChanged) {
            updatePromises.push(getPendingPages().then(updated => {
                pendingPages.length = 0;
                pendingPages.push(...updated);
                pendingUrlSet.clear();
                updated.forEach(p => pendingUrlSet.add(p.url));
            }));
        }
        Promise.all(updatePromises).then(() => applyFilters());
    };
    chrome.storage.onChanged.addListener(onStorageChanged);
    function makeRecordTypeBadge(recordType) {
        const badge = document.createElement('span');
        if (recordType === 'manual') {
            badge.className = 'history-badge history-badge-manual';
            badge.textContent = getMessage('recordTypeManual') || '手動';
        }
        else {
            badge.className = 'history-badge history-badge-auto';
            badge.textContent = getMessage('recordTypeAuto') || '自動';
        }
        return badge;
    }
    function makeMaskBadge(maskedCount) {
        if (!maskedCount || maskedCount === 0)
            return null;
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
    function makeTagBadges(tags, url) {
        if (!tags || tags.length === 0)
            return null;
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
                }
                else {
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
    function updateTagFilterIndicator() {
        // 既存のインジケーターを削除
        const existingIndicator = document.getElementById('tagFilterIndicator');
        if (existingIndicator) {
            existingIndicator.remove();
        }
        // アクティブなタグフィルターがない場合は何もしない
        if (!activeTagFilter)
            return;
        // 履歴コントロールの後にインジケーターを追加
        const controls = document.querySelector('.history-controls');
        if (!controls)
            return;
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
    function applyFilters(resetPage = true) {
        if (!historyList)
            return;
        const searchText = (historySearchInput?.value || '').toLowerCase();
        // フィルター適用: activeFilter が 'skipped' のときは pendingUrlSet から表示
        if (activeFilter === 'skipped') {
            renderSkippedMode(searchText);
            return;
        }
        const filtered = entries.filter(e => {
            const matchesSearch = !searchText || e.url.toLowerCase().includes(searchText);
            const matchesType = activeFilter === 'all' ||
                (activeFilter === 'auto' && (!e.recordType || e.recordType === 'auto')) ||
                (activeFilter === 'manual' && e.recordType === 'manual') ||
                (activeFilter === 'masked' && !!e.maskedCount && e.maskedCount > 0);
            // タグフィルター
            const matchesTag = !activeTagFilter || (e.tags && e.tags.includes(activeTagFilter));
            return matchesSearch && matchesType && matchesTag;
        });
        if (resetPage)
            historyCurrentPage = 0;
        const totalPages = Math.ceil(filtered.length / HISTORY_PAGE_SIZE);
        if (historyCurrentPage >= totalPages && historyCurrentPage > 0)
            historyCurrentPage = totalPages - 1;
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
            if (maskBadge)
                topRow.appendChild(maskBadge);
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
            }
            else {
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
                if (idx !== -1)
                    entries.splice(idx, 1);
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
    function renderPendingReason(reason) {
        switch (reason) {
            case 'cache-control': return getMessage('pendingReasonCache') || 'Cache-Control ヘッダー';
            case 'set-cookie': return getMessage('pendingReasonCookie') || 'Set-Cookie ヘッダー';
            case 'authorization': return getMessage('pendingReasonAuth') || 'Authorization ヘッダー';
            default: return reason;
        }
    }
    function renderSkippedMode(searchText) {
        if (!historyList)
            return;
        const filtered = pendingPages.filter(p => !searchText ||
            p.url.toLowerCase().includes(searchText) ||
            (p.title || '').toLowerCase().includes(searchText));
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
            const recordBtn = document.createElement('button');
            recordBtn.className = 'secondary-btn pending-record-btn';
            recordBtn.textContent = getMessage('recordNow') || '📝 今すぐ記録';
            recordBtn.addEventListener('click', async () => {
                recordBtn.disabled = true;
                recordBtn.textContent = getMessage('processing') || '処理中...';
                // エラーメッセージ表示用要素を準備
                let errorEl = row.querySelector('.record-error-message');
                if (errorEl)
                    errorEl.remove();
                try {
                    const result = await chrome.runtime.sendMessage({
                        type: 'MANUAL_RECORD',
                        payload: { title: page.title, url: page.url, content: '', force: true }
                    });
                    if (result?.success) {
                        await removePendingPages([page.url]);
                        const pIdx = pendingPages.findIndex(p => p.url === page.url);
                        if (pIdx !== -1)
                            pendingPages.splice(pIdx, 1);
                        pendingUrlSet.delete(page.url);
                        row.remove();
                        if (historyList.children.length === 0) {
                            historyList.innerHTML = `<div class="history-empty">${getMessage('historyEmpty') || 'No history found.'}</div>`;
                        }
                        if (historyStats)
                            historyStats.textContent = `${pendingPages.length} / ${pendingPages.length}`;
                    }
                    else {
                        showRecordError(info, result);
                        recordBtn.disabled = false;
                        recordBtn.textContent = getMessage('recordNow') || '📝 今すぐ記録';
                    }
                }
                catch (error) {
                    showRecordError(info, error);
                    recordBtn.disabled = false;
                    recordBtn.textContent = getMessage('recordNow') || '📝 今すぐ記録';
                }
            });
            row.appendChild(info);
            row.appendChild(recordBtn);
            historyList.appendChild(row);
        }
    }
    applyFilters();
    // タグパネルからのナビゲーションイベントを受信
    document.addEventListener('navigate-to-tag', (e) => {
        const tag = e.detail;
        activeTagFilter = tag;
        activeFilter = 'all';
        historyCurrentPage = 0;
        // 履歴パネルに切り替え
        document.querySelectorAll('.sidebar-nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        document.querySelector('[data-panel="panel-history"]')?.classList.add('active');
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
            activeFilter = (btn.dataset['filter'] || 'all');
            // タグフィルターをリセット
            activeTagFilter = null;
            updateTagFilterIndicator();
            applyFilters();
        });
    });
    // ──────────────────────────────────────────────────────────────────────────
    // 保留中ページ（記録できなかった）セクション — ページ上部の警告ボックス
    // ──────────────────────────────────────────────────────────────────────────
    if (!pendingSection || !pendingList)
        return;
    if (pendingPages.length === 0) {
        pendingSection.hidden = true;
        return;
    }
    pendingSection.hidden = false;
    // 最新順（timestamp降順）に並べる
    const sortedPending = [...pendingPages].sort((a, b) => b.timestamp - a.timestamp);
    const PENDING_PAGE_SIZE = 10;
    let pendingCurrentPage = 0;
    function renderPendingPage() {
        if (!pendingList)
            return;
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
            const recordBtn = document.createElement('button');
            recordBtn.className = 'secondary-btn pending-record-btn';
            recordBtn.textContent = getMessage('recordNow') || '📝 今すぐ記録';
            recordBtn.addEventListener('click', async () => {
                recordBtn.disabled = true;
                recordBtn.textContent = getMessage('processing') || '処理中...';
                let errorEl = row.querySelector('.record-error-message');
                if (errorEl)
                    errorEl.remove();
                try {
                    const result = await chrome.runtime.sendMessage({
                        type: 'MANUAL_RECORD',
                        payload: { title: page.title, url: page.url, content: '', force: true }
                    });
                    if (result?.success) {
                        await removePendingPages([page.url]);
                        const pIdx = pendingPages.findIndex(p => p.url === page.url);
                        if (pIdx !== -1) {
                            pendingPages.splice(pIdx, 1);
                            sortedPending.splice(sortedPending.findIndex(p => p.url === page.url), 1);
                        }
                        pendingUrlSet.delete(page.url);
                        if (pendingCurrentPage > 0 && pendingCurrentPage * PENDING_PAGE_SIZE >= sortedPending.length) {
                            pendingCurrentPage--;
                        }
                        if (sortedPending.length === 0) {
                            pendingSection.hidden = true;
                        }
                        else {
                            renderPendingPage();
                        }
                        if (activeFilter === 'skipped')
                            applyFilters();
                    }
                    else {
                        showRecordError(info, result);
                        recordBtn.disabled = false;
                        recordBtn.textContent = getMessage('recordNow') || '📝 今すぐ記録';
                    }
                }
                catch (error) {
                    showRecordError(info, error);
                    recordBtn.disabled = false;
                    recordBtn.textContent = getMessage('recordNow') || '📝 今すぐ記録';
                }
            });
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'danger-btn pending-delete-btn';
            deleteBtn.textContent = getMessage('pendingDeleteForever') || '🗑 完全削除';
            deleteBtn.addEventListener('click', async () => {
                deleteBtn.disabled = true;
                try {
                    await removePendingPages([page.url]);
                    const pIdx = pendingPages.findIndex(p => p.url === page.url);
                    if (pIdx !== -1)
                        pendingPages.splice(pIdx, 1);
                    sortedPending.splice(sortedPending.findIndex(p => p.url === page.url), 1);
                    pendingUrlSet.delete(page.url);
                    if (pendingCurrentPage > 0 && pendingCurrentPage * PENDING_PAGE_SIZE >= sortedPending.length) {
                        pendingCurrentPage--;
                    }
                    if (sortedPending.length === 0) {
                        pendingSection.hidden = true;
                    }
                    else {
                        renderPendingPage();
                    }
                    if (activeFilter === 'skipped')
                        applyFilters();
                }
                catch {
                    deleteBtn.disabled = false;
                }
            });
            btnGroup.appendChild(recordBtn);
            btnGroup.appendChild(deleteBtn);
            row.appendChild(info);
            row.appendChild(btnGroup);
            pendingList.appendChild(row);
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
            pendingList.appendChild(nav);
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
    function openTagEditModal(url, currentTags) {
        editingUrl = url;
        editingTags = [...currentTags];
        if (tagEditUrl)
            tagEditUrl.textContent = url;
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
    function closeTagEditModal() {
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
    function renderCurrentTags() {
        if (!currentTagsList || !noCurrentTagsMsg)
            return;
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
    async function updateTagCategorySelect() {
        if (!tagCategorySelect || !addTagBtn)
            return;
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
    function addTag() {
        if (!tagCategorySelect || !tagCategorySelect.value)
            return;
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
    async function saveTagEdits() {
        if (!editingUrl)
            return;
        try {
            await setUrlTags(editingUrl, editingTags);
            // エントリの更新
            const entryIndex = entries.findIndex(e => e.url === editingUrl);
            if (entryIndex !== -1) {
                entries[entryIndex].tags = editingTags;
            }
            closeTagEditModal();
            applyFilters(false);
        }
        catch (error) {
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
        if (addTagBtn)
            addTagBtn.disabled = !tagCategorySelect.value;
    });
    addTagBtn?.addEventListener('click', addTag);
    saveTagEditsBtn?.addEventListener('click', saveTagEdits);
    renderPendingPage();
}
// ============================================================================
// Domain Filter Tag UI
// ============================================================================
async function initDomainFilterTagUI() {
    // --- hidden要素参照（domainFilter.ts が管理する既存ロジック）---
    const radioBlacklist = document.getElementById('filterBlacklist');
    const radioWhitelist = document.getElementById('filterWhitelist');
    const radioDisabled = document.getElementById('filterDisabled');
    const blacklistTA = document.getElementById('blacklistTextarea');
    const whitelistTA = document.getElementById('whitelistTextarea');
    const domainListTA = document.getElementById('domainList');
    const realSaveBtn = document.getElementById('saveDomainSettings');
    const realStatus = document.getElementById('domainStatus');
    // --- 新UI要素参照 ---
    const toggle = document.getElementById('domainFilterToggle');
    const tabBar = document.getElementById('domainModeTabBar');
    const tagArea = document.getElementById('domainTagArea');
    const tabBlacklist = document.getElementById('domainModeTab-blacklist');
    const tabWhitelist = document.getElementById('domainModeTab-whitelist');
    const modeDesc = document.getElementById('domainModeDesc');
    const tagCount = document.getElementById('domainTagCount');
    const tagList = document.getElementById('domainTagList');
    const tagInput = document.getElementById('domainTagInput');
    const tagAddBtn = document.getElementById('domainTagAddBtn');
    const tagError = document.getElementById('domainTagError');
    const saveBtn = document.getElementById('domainSaveBtn');
    const saveStatus = document.getElementById('domainSaveStatus');
    if (!radioBlacklist || !radioWhitelist || !radioDisabled)
        return;
    function getCurrentMode() {
        return radioWhitelist.checked ? 'whitelist' : 'blacklist';
    }
    function getTA(mode) {
        return mode === 'blacklist' ? blacklistTA : whitelistTA;
    }
    function getDomains(mode) {
        const ta = getTA(mode);
        if (!ta || !ta.value.trim())
            return [];
        return ta.value.split('\n').map(d => d.trim()).filter(Boolean);
    }
    function setDomains(mode, domains) {
        const ta = getTA(mode);
        if (!ta)
            return;
        ta.value = domains.join('\n');
        // domainListTA も同期（domainFilter.ts の保存ロジック用）
        if (domainListTA)
            domainListTA.value = ta.value;
    }
    function updateModeDesc(mode) {
        if (!modeDesc)
            return;
        if (mode === 'blacklist') {
            modeDesc.textContent = getMessage('domainBlacklistDesc') ||
                'ブラックリストのドメインは記録されません。それ以外はすべて記録されます。';
        }
        else {
            modeDesc.textContent = getMessage('domainWhitelistDesc') ||
                'ホワイトリストのドメインのみ記録されます。それ以外は記録されません。';
        }
    }
    function renderTags(mode) {
        if (!tagList || !tagCount)
            return;
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
    function addDomain(rawInput, mode) {
        if (!tagError)
            return;
        tagError.textContent = '';
        const domain = rawInput.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        if (!domain)
            return;
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
        if (tagInput)
            tagInput.value = '';
    }
    function removeDomain(domain, mode) {
        const updated = getDomains(mode).filter(d => d !== domain);
        setDomains(mode, updated);
        renderTags(mode);
    }
    function switchTab(mode) {
        if (mode === 'blacklist') {
            radioBlacklist.checked = true;
            tabBlacklist?.classList.add('active');
            tabBlacklist?.setAttribute('aria-selected', 'true');
            tabWhitelist?.classList.remove('active');
            tabWhitelist?.setAttribute('aria-selected', 'false');
        }
        else {
            radioWhitelist.checked = true;
            tabWhitelist?.classList.add('active');
            tabWhitelist?.setAttribute('aria-selected', 'true');
            tabBlacklist?.classList.remove('active');
            tabBlacklist?.setAttribute('aria-selected', 'false');
        }
        // domainListTA を現在モードの textarea に同期
        const ta = getTA(mode);
        if (domainListTA && ta)
            domainListTA.value = ta.value;
        updateModeDesc(mode);
        renderTags(mode);
        if (tagError)
            tagError.textContent = '';
    }
    function setEnabled(enabled) {
        if (enabled) {
            radioDisabled.checked = false;
            // 前回のモードを復元（どちらもチェックされていなければ blacklist をデフォルト）
            if (!radioBlacklist.checked && !radioWhitelist.checked) {
                radioBlacklist.checked = true;
            }
        }
        else {
            radioDisabled.checked = true;
            radioBlacklist.checked = false;
            radioWhitelist.checked = false;
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
    function syncFromHidden() {
        const isEnabled = !radioDisabled.checked;
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
        if (tagInput)
            addDomain(tagInput.value, getCurrentMode());
    });
    tagInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addDomain(tagInput.value, getCurrentMode());
        }
    });
    tagInput?.addEventListener('input', () => {
        if (tagError)
            tagError.textContent = '';
    });
    // 保存ボタン → 既存の hidden saveDomainSettings ボタンに委譲
    saveBtn?.addEventListener('click', () => {
        if (saveStatus)
            saveStatus.textContent = '';
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
async function initTagsPanel() {
    const tagSummaryModeInput = document.getElementById('tagSummaryMode');
    const defaultCategoriesList = document.getElementById('defaultCategoriesList');
    const userCategoriesList = document.getElementById('userCategoriesUserList');
    const noUserCategoriesMsg = document.getElementById('noUserCategoriesMsg');
    const newCategoryInput = document.getElementById('newCategoryInput');
    const addCategoryBtn = document.getElementById('addCategoryBtn');
    const saveTagsBtn = document.getElementById('saveTagsBtn');
    const userCategoriesListEl = document.getElementById('userCategoriesList');
    // ユーザーが追加したカテゴリの状態（一時保存）
    let userCategories = [];
    /**
     * デフォルトカテゴリを表示
     */
    function renderDefaultCategories() {
        if (!defaultCategoriesList)
            return;
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
    function renderUserCategories() {
        if (!userCategoriesListEl || !noUserCategoriesMsg)
            return;
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
    function addCategory() {
        if (!newCategoryInput)
            return;
        const categoryName = newCategoryInput.value.trim();
        if (!categoryName)
            return;
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
    async function saveTagSettings() {
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
        }
        catch (error) {
            console.error('[TagsPanel] Failed to save tag settings:', error);
            showStatus('exportImportStatus', getMessage('saveError') || '保存エラー', 'error');
        }
    }
    /**
     * 設定をロード
     */
    async function loadTagSettings() {
        const settings = await getSettings();
        // タグ付き要約モード
        if (tagSummaryModeInput) {
            tagSummaryModeInput.checked = settings[StorageKeys.TAG_SUMMARY_MODE] || false;
        }
        // ユーザーカテゴリ
        const savedUserCategories = settings[StorageKeys.TAG_CATEGORIES] || [];
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
function initDomainSearchPanel() {
    const searchInput = document.getElementById('domainSearchInput');
    const matchesEl = document.getElementById('domainSearchMatches');
    const checkInput = document.getElementById('domainCheckInput');
    const resultEl = document.getElementById('domainSearchResult');
    // --- Part 1: Filter list incremental search ---
    async function runFilterSearch() {
        if (!searchInput || !matchesEl)
            return;
        const query = searchInput.value.trim().toLowerCase();
        matchesEl.innerHTML = '';
        if (!query)
            return;
        const settings = await getSettings();
        const blacklist = settings[StorageKeys.DOMAIN_BLACKLIST] || [];
        const whitelist = settings[StorageKeys.DOMAIN_WHITELIST] || [];
        const blackMatches = blacklist.filter(d => d.toLowerCase().includes(query));
        const whiteMatches = whitelist.filter(d => d.toLowerCase().includes(query));
        if (blackMatches.length === 0 && whiteMatches.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'domain-match-empty';
            empty.textContent = getMessage('domainNoMatches') || 'No matching rules found.';
            matchesEl.appendChild(empty);
            return;
        }
        function renderGroup(items, listType) {
            if (items.length === 0)
                return;
            const label = listType === 'blacklist'
                ? (getMessage('blacklistLabel') || 'Blacklist')
                : (getMessage('whitelistLabel') || 'Whitelist');
            const header = document.createElement('div');
            header.className = `domain-match-group-header domain-match-group-${listType}`;
            header.textContent = `${label} (${items.length})`;
            matchesEl.appendChild(header);
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
                }
                else {
                    row.textContent = domain;
                }
                matchesEl.appendChild(row);
            });
        }
        renderGroup(blackMatches, 'blacklist');
        renderGroup(whiteMatches, 'whitelist');
    }
    function escapeHtml(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    searchInput?.addEventListener('input', runFilterSearch);
    // --- Part 2: URL allowed/blocked check ---
    async function runCheck() {
        if (!checkInput || !resultEl)
            return;
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
            }
            else {
                resultEl.className = 'domain-search-result visible blocked';
                resultEl.textContent = `✗ ${domain} — ${getMessage('domainBlocked') || 'Blocked (will not be recorded)'}`;
            }
        }
        catch (e) {
            resultEl.className = 'domain-search-result visible info';
            resultEl.textContent = getMessage('checkError') || 'Error checking domain.';
        }
    }
    checkInput?.addEventListener('input', runCheck);
}
// ============================================================================
// Diagnostics Panel
// ============================================================================
async function initDiagnosticsPanel() {
    const storageStats = document.getElementById('diagStorageStats');
    const extInfo = document.getElementById('diagExtInfo');
    const diagTestObsidianBtn = document.getElementById('diagTestObsidianBtn');
    const diagTestAiBtn = document.getElementById('diagTestAiBtn');
    const connectionResult = document.getElementById('diagConnectionResult');
    const obsidianSettingsEl = document.getElementById('diagObsidianSettings');
    const aiSettingsEl = document.getElementById('diagAiSettings');
    function makeStatRow(label, value, masked = false) {
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
            const protocol = settings[StorageKeys.OBSIDIAN_PROTOCOL] || 'https';
            const port = settings[StorageKeys.OBSIDIAN_PORT] || '27124';
            const apiKey = settings[StorageKeys.OBSIDIAN_API_KEY] || '';
            const dailyPath = settings[StorageKeys.OBSIDIAN_DAILY_PATH] || '';
            obsidianSettingsEl.appendChild(makeStatRow('Protocol', protocol));
            obsidianSettingsEl.appendChild(makeStatRow('Port', port));
            obsidianSettingsEl.appendChild(makeStatRow('REST API URL', `${protocol}://127.0.0.1:${port}`));
            obsidianSettingsEl.appendChild(makeStatRow('Daily Note Path', dailyPath || '(デフォルト)'));
            obsidianSettingsEl.appendChild(makeStatRow('API Key', apiKey ? `${'•'.repeat(8)} (設定済み)` : '(未設定)', !apiKey));
        }
        if (aiSettingsEl) {
            const provider = settings[StorageKeys.AI_PROVIDER] || 'gemini';
            const providerLabels = {
                gemini: 'Google Gemini',
                openai: 'OpenAI Compatible',
                openai2: 'OpenAI Compatible 2',
            };
            aiSettingsEl.appendChild(makeStatRow('Provider', providerLabels[provider] || provider));
            if (provider === 'gemini') {
                const model = settings[StorageKeys.GEMINI_MODEL] || '';
                const key = settings[StorageKeys.GEMINI_API_KEY] || '';
                aiSettingsEl.appendChild(makeStatRow('Model', model || '(未設定)'));
                aiSettingsEl.appendChild(makeStatRow('API Key', key ? `${'•'.repeat(8)} (設定済み)` : '(未設定)', !key));
            }
            else if (provider === 'openai') {
                const baseUrl = settings[StorageKeys.OPENAI_BASE_URL] || '';
                const model = settings[StorageKeys.OPENAI_MODEL] || '';
                const key = settings[StorageKeys.OPENAI_API_KEY] || '';
                aiSettingsEl.appendChild(makeStatRow('Base URL', baseUrl || '(未設定)'));
                aiSettingsEl.appendChild(makeStatRow('Model', model || '(未設定)'));
                aiSettingsEl.appendChild(makeStatRow('API Key', key ? `${'•'.repeat(8)} (設定済み)` : '(未設定)', !key));
            }
            else if (provider === 'openai2') {
                const baseUrl = settings[StorageKeys.OPENAI_2_BASE_URL] || '';
                const model = settings[StorageKeys.OPENAI_2_MODEL] || '';
                const key = settings[StorageKeys.OPENAI_2_API_KEY] || '';
                aiSettingsEl.appendChild(makeStatRow('Base URL', baseUrl || '(未設定)'));
                aiSettingsEl.appendChild(makeStatRow('Model', model || '(未設定)'));
                aiSettingsEl.appendChild(makeStatRow('API Key', key ? `${'•'.repeat(8)} (設定済み)` : '(未設定)', !key));
            }
        }
    }
    catch {
        obsidianSettingsEl && (obsidianSettingsEl.textContent = '設定の読み込みに失敗しました。');
    }
    // Storage stats
    if (storageStats) {
        try {
            const bytesUsed = await chrome.storage.local.getBytesInUse(null);
            const kb = (bytesUsed / 1024).toFixed(1);
            const urlCount = await getSavedUrlCount();
            storageStats.appendChild(makeStatRow(getMessage('diagStorageUsed') || 'Storage Used', `${kb} KB`));
            storageStats.appendChild(makeStatRow(getMessage('diagSavedUrls') || 'Saved URLs', String(urlCount)));
        }
        catch {
            storageStats.textContent = getMessage('diagLoadError') || 'Failed to load storage info.';
        }
    }
    // Extension info
    if (extInfo) {
        const manifest = chrome.runtime.getManifest();
        extInfo.appendChild(makeStatRow(getMessage('diagVersion') || 'Version', manifest.version));
        extInfo.appendChild(makeStatRow(getMessage('diagExtName') || 'Extension', manifest.name));
    }
    // プレースホルダーテキストをdata属性にセット（CSS ::before で表示）
    if (connectionResult) {
        connectionResult.dataset['placeholder'] = getMessage('diagConnectionPlaceholder') || 'Click "Test Connection" to check the Obsidian API connection.';
    }
    // Obsidian 接続テスト
    diagTestObsidianBtn?.addEventListener('click', async () => {
        if (!connectionResult)
            return;
        diagTestObsidianBtn.disabled = true;
        connectionResult.textContent = getMessage('testing') || 'Testing...';
        connectionResult.className = 'diag-result';
        try {
            const testResult = await chrome.runtime.sendMessage({
                type: 'TEST_OBSIDIAN',
                payload: {}
            });
            const obsidian = testResult?.obsidian;
            connectionResult.textContent = obsidian
                ? `Obsidian: ${obsidian.success ? '✓' : '✗'} ${obsidian.message}`
                : getMessage('testComplete') || 'Test complete.';
            connectionResult.style.color = obsidian?.success ? 'var(--color-success, #22c55e)' : 'var(--color-danger, #ef4444)';
        }
        catch (e) {
            connectionResult.textContent = getMessage('testError') || 'Connection test failed.';
            connectionResult.style.color = 'var(--color-danger, #ef4444)';
        }
        finally {
            diagTestObsidianBtn.disabled = false;
        }
    });
    // AI 接続テスト
    diagTestAiBtn?.addEventListener('click', async () => {
        if (!connectionResult)
            return;
        diagTestAiBtn.disabled = true;
        connectionResult.textContent = getMessage('testing') || 'Testing...';
        connectionResult.className = 'diag-result';
        try {
            const testResult = await chrome.runtime.sendMessage({
                type: 'TEST_AI',
                payload: {}
            });
            const ai = testResult?.ai;
            connectionResult.textContent = ai
                ? `AI: ${ai.success ? '✓' : '✗'} ${ai.message}`
                : getMessage('testComplete') || 'Test complete.';
            connectionResult.style.color = ai?.success ? 'var(--color-success, #22c55e)' : 'var(--color-danger, #ef4444)';
        }
        catch (e) {
            connectionResult.textContent = getMessage('testError') || 'Connection test failed.';
            connectionResult.style.color = 'var(--color-danger, #ef4444)';
        }
        finally {
            diagTestAiBtn.disabled = false;
        }
    });
}
// ============================================================================
// Initialization
// ============================================================================
function setHtmlLangDir() {
    const locale = chrome.i18n.getUILanguage();
    const langCode = locale.split('-')[0];
    document.documentElement.lang = locale;
    const rtlLanguages = ['ar', 'he', 'fa', 'ur', 'ku', 'yi', 'dv'];
    document.documentElement.dir = rtlLanguages.includes(langCode) ? 'rtl' : 'ltr';
}
(async () => {
    console.log('[Dashboard] Starting initialization...');
    try {
        setHtmlLangDir();
    }
    catch (e) {
        console.error('[Dashboard] setHtmlLangDir error:', e);
    }
    initSidebarNav();
    try {
        initDomainFilter();
    }
    catch (e) {
        console.error('[Dashboard] initDomainFilter error:', e);
    }
    try {
        await initDomainFilterTagUI();
    }
    catch (e) {
        console.error('[Dashboard] initDomainFilterTagUI error:', e);
    }
    try {
        initPrivacySettings();
    }
    catch (e) {
        console.error('[Dashboard] initPrivacySettings error:', e);
    }
    try {
        const settings = await getSettings();
        initCustomPromptManager(settings);
    }
    catch (e) {
        console.error('[Dashboard] initCustomPromptManager error:', e);
    }
    try {
        await loadGeneralSettings();
    }
    catch (e) {
        console.error('[Dashboard] loadGeneralSettings error:', e);
    }
    try {
        await loadMasterPasswordSettings();
    }
    catch (e) {
        console.error('[Dashboard] loadMasterPasswordSettings error:', e);
    }
    setupAIProviderChangeListener(aiProviderElements);
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
    try {
        await initHistoryPanel();
    }
    catch (e) {
        console.error('[Dashboard] initHistoryPanel error:', e);
    }
    try {
        initDomainSearchPanel();
    }
    catch (e) {
        console.error('[Dashboard] initDomainSearchPanel error:', e);
    }
    try {
        await initTagsPanel();
    }
    catch (e) {
        console.error('[Dashboard] initTagsPanel error:', e);
    }
    try {
        await initDiagnosticsPanel();
    }
    catch (e) {
        console.error('[Dashboard] initDiagnosticsPanel error:', e);
    }
    console.log('[Dashboard] Initialization complete');
})();
//# sourceMappingURL=dashboard.js.map