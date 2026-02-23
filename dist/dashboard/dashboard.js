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
import { getSavedUrlEntries, removeSavedUrl, getSavedUrlCount } from '../utils/storageUrls.js';
import { getPendingPages, removePendingPages } from '../utils/pendingStorage.js';
import { extractDomain, isDomainAllowed } from '../utils/domainUtils.js';
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
const testConnectionBtn = document.getElementById('testConnectionBtn');
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
async function handleTestOnly() {
    if (!testConnectionBtn)
        return;
    statusDiv.innerHTML = '';
    statusDiv.className = '';
    statusDiv.textContent = getMessage('testingConnection') || '接続テスト中...';
    testConnectionBtn.disabled = true;
    try {
        const testResult = await chrome.runtime.sendMessage({
            type: 'TEST_CONNECTIONS',
            payload: {}
        });
        const obsidianResult = testResult?.obsidian || { success: false, message: 'No response' };
        const aiResult = testResult?.ai || { success: false, message: 'No response' };
        // ステータスエリアをクリア
        statusDiv.innerHTML = '';
        // Obsidian接続結果
        const obsidianStatus = document.createElement('div');
        obsidianStatus.style.marginBottom = '8px';
        const obsidianLabel = document.createElement('strong');
        obsidianLabel.textContent = '📦 Obsidian: ';
        obsidianStatus.appendChild(obsidianLabel);
        const obsidianSpan = document.createElement('span');
        if (obsidianResult.success) {
            obsidianSpan.textContent = '✅ ' + (getMessage('connectionSuccess') || '接続成功');
            obsidianSpan.style.color = '#2E7D32';
        }
        else {
            obsidianSpan.textContent = '❌ ' + obsidianResult.message;
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
        // AI接続結果
        const aiStatus = document.createElement('div');
        aiStatus.style.marginBottom = '8px';
        const aiLabel = document.createElement('strong');
        aiLabel.textContent = '🤖 AI: ';
        aiStatus.appendChild(aiLabel);
        const aiSpan = document.createElement('span');
        if (aiResult.success) {
            aiSpan.textContent = '✅ ' + (getMessage('connectionSuccess') || '接続成功');
            aiSpan.style.color = '#2E7D32';
        }
        else {
            aiSpan.textContent = '❌ ' + aiResult.message;
            aiSpan.style.color = '#D32F2F';
        }
        aiStatus.appendChild(aiSpan);
        statusDiv.appendChild(aiStatus);
        statusDiv.className = (obsidianResult.success && aiResult.success) ? 'success' : 'error';
    }
    catch (e) {
        statusDiv.textContent = getMessage('testError') || '接続テストに失敗しました。';
        statusDiv.className = 'error';
    }
    finally {
        testConnectionBtn.disabled = false;
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
    if (!historyList)
        return;
    // 記録済みエントリ（recordType付き）を取得
    const rawEntries = await getSavedUrlEntries();
    // pending URLセットを取得（スキップ表示に使う）
    const pendingPages = await getPendingPages();
    const pendingUrlSet = new Set(pendingPages.map(p => p.url));
    let entries = rawEntries.slice().sort((a, b) => b.timestamp - a.timestamp);
    let activeFilter = 'all';
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
    function applyFilters() {
        if (!historyList)
            return;
        const searchText = (historySearchInput?.value || '').toLowerCase();
        // フィルター適用: activeFilter が 'skipped' のときは pendingUrlSet から表示
        let filtered;
        if (activeFilter === 'skipped') {
            // pendingPagesを対象にする（別レンダリング）
            renderSkippedMode(searchText);
            return;
        }
        else {
            filtered = entries.filter(e => {
                const matchesSearch = !searchText || e.url.toLowerCase().includes(searchText);
                const matchesType = activeFilter === 'all' ||
                    (activeFilter === 'auto' && (!e.recordType || e.recordType === 'auto')) ||
                    (activeFilter === 'manual' && e.recordType === 'manual') ||
                    (activeFilter === 'masked' && !!e.maskedCount && e.maskedCount > 0);
                return matchesSearch && matchesType;
            });
        }
        if (historyStats) {
            historyStats.textContent = `${filtered.length} / ${entries.length}`;
        }
        if (filtered.length === 0) {
            historyList.innerHTML = `<div class="history-empty">${getMessage('historyEmpty') || 'No history found.'}</div>`;
            return;
        }
        historyList.innerHTML = '';
        filtered.forEach(entry => {
            const { url, timestamp, recordType, maskedCount } = entry;
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
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'history-entry-delete';
            deleteBtn.textContent = '×';
            deleteBtn.setAttribute('aria-label', getMessage('deleteEntry') || 'Delete');
            deleteBtn.addEventListener('click', async () => {
                await removeSavedUrl(url);
                const idx = entries.findIndex(e => e.url === url);
                if (idx !== -1)
                    entries.splice(idx, 1);
                applyFilters();
            });
            row.appendChild(info);
            row.appendChild(deleteBtn);
            historyList.appendChild(row);
        });
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
    historySearchInput?.addEventListener('input', () => {
        applyFilters();
    });
    // フィルターボタン
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
            btn.classList.add('active');
            btn.setAttribute('aria-pressed', 'true');
            activeFilter = (btn.dataset['filter'] || 'all');
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
    pendingList.innerHTML = '';
    for (const page of pendingPages) {
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
                    if (pendingList.children.length === 0) {
                        pendingSection.hidden = true;
                    }
                    // スキップフィルター表示中なら再レンダリング
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
        row.appendChild(info);
        row.appendChild(recordBtn);
        pendingList.appendChild(row);
    }
}
// ============================================================================
// Domain Filter Tag UI
// ============================================================================
function initDomainFilterTagUI() {
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
    // 初期化: domainFilter.ts の loadDomainSettings() 完了後に同期
    setTimeout(syncFromHidden, 50);
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
    const testConnectionBtn = document.getElementById('diagTestConnectionBtn');
    const connectionResult = document.getElementById('diagConnectionResult');
    function makeStatRow(label, value) {
        const row = document.createElement('div');
        row.className = 'diag-stat-row';
        row.innerHTML = `<span class="diag-stat-label">${label}</span><span class="diag-stat-value">${value}</span>`;
        return row;
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
    // Connection test
    testConnectionBtn?.addEventListener('click', async () => {
        if (!connectionResult)
            return;
        testConnectionBtn.disabled = true;
        connectionResult.textContent = getMessage('testing') || 'Testing...';
        connectionResult.className = 'diag-result';
        try {
            const testResult = await chrome.runtime.sendMessage({
                type: 'TEST_CONNECTIONS',
                payload: {}
            });
            const obsidian = testResult?.obsidian;
            const ai = testResult?.ai;
            const lines = [];
            if (obsidian) {
                lines.push(`Obsidian: ${obsidian.success ? '✓' : '✗'} ${obsidian.message}`);
            }
            if (ai) {
                lines.push(`AI: ${ai.success ? '✓' : '✗'} ${ai.message}`);
            }
            connectionResult.textContent = lines.join('\n') || getMessage('testComplete') || 'Test complete.';
            const allOk = obsidian?.success && ai?.success;
            connectionResult.style.color = allOk ? 'var(--color-success, #22c55e)' : 'var(--color-danger, #ef4444)';
        }
        catch (e) {
            connectionResult.textContent = getMessage('testError') || 'Connection test failed.';
            connectionResult.style.color = 'var(--color-danger, #ef4444)';
        }
        finally {
            testConnectionBtn.disabled = false;
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
        initDomainFilterTagUI();
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
    testConnectionBtn?.addEventListener('click', async () => {
        await handleTestOnly();
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
        await initDiagnosticsPanel();
    }
    catch (e) {
        console.error('[Dashboard] initDiagnosticsPanel error:', e);
    }
    console.log('[Dashboard] Initialization complete');
})();
//# sourceMappingURL=dashboard.js.map