/**
 * domainFilter.ts
 * Domain filter settings functionality for the popup UI.
 */
import { StorageKeys, getSettings, saveSettings } from '../utils/storage.js';
import { parseDomainList, validateDomainList } from '../utils/domainUtils.js';
// @ts-ignore: ublockImport/index.js might not be converted yet or type definitions missing
import { init as initUblockImport, handleSaveUblockSettings } from './ublockImport.js';
import { addLog, LogType } from '../utils/logger.js';
import { showStatus } from './settingsUiHelper.js';
import { getMessage } from './i18n.js';
// Elements
const generalTabBtn = document.getElementById('generalTab');
const domainTabBtn = document.getElementById('domainTab');
const promptTabBtn = document.getElementById('promptTab');
const privacyTabBtn = document.getElementById('privacyTab');
const generalPanel = document.getElementById('generalPanel');
const domainPanel = document.getElementById('domainPanel');
const promptPanel = document.getElementById('promptPanel');
const privacyPanel = document.getElementById('privacyPanel');
// Domain filter elements
const filterDisabledRadio = document.getElementById('filterDisabled');
const filterWhitelistRadio = document.getElementById('filterWhitelist');
const filterBlacklistRadio = document.getElementById('filterBlacklist');
const domainListSection = document.getElementById('domainListSection');
const domainListLabel = document.getElementById('domainListLabel');
const domainListTextarea = document.getElementById('domainList');
const whitelistTextarea = document.getElementById('whitelistTextarea');
const blacklistTextarea = document.getElementById('blacklistTextarea');
const saveDomainSettingsBtn = document.getElementById('saveDomainSettings');
// uBlock形式要素
const simpleFormatEnabledCheckbox = document.getElementById('simpleFormatEnabled');
const ublockFormatEnabledCheckbox = document.getElementById('ublockFormatEnabled');
const simpleFormatUI = document.getElementById('simpleFormatUI');
const uBlockFormatUI = document.getElementById('uBlockFormatUI');
// Tab switching functionality
export function init() {
    // Tab switching
    if (generalTabBtn) {
        generalTabBtn.addEventListener('click', () => {
            showTab('general');
        });
    }
    if (domainTabBtn) {
        domainTabBtn.addEventListener('click', async () => {
            showTab('domain');
            // Reload domain settings when switching to domain tab
            await loadDomainSettings();
        });
    }
    if (promptTabBtn) {
        promptTabBtn.addEventListener('click', () => {
            showTab('prompt');
        });
    }
    if (privacyTabBtn) {
        privacyTabBtn.addEventListener('click', () => {
            showTab('privacy');
        });
    }
    // Domain filter mode change
    if (filterDisabledRadio && filterWhitelistRadio && filterBlacklistRadio) {
        [filterDisabledRadio, filterWhitelistRadio, filterBlacklistRadio].forEach(radio => {
            radio.addEventListener('change', updateDomainListVisibility);
        });
    }
    // フィルター形式切替
    if (simpleFormatEnabledCheckbox && ublockFormatEnabledCheckbox) {
        simpleFormatEnabledCheckbox.addEventListener('change', toggleFormatUI);
        ublockFormatEnabledCheckbox.addEventListener('change', toggleFormatUI);
    }
    // uBlock形式の初期化
    if (typeof initUblockImport === 'function') {
        initUblockImport();
    }
    // Save domain settings
    if (saveDomainSettingsBtn) {
        saveDomainSettingsBtn.addEventListener('click', handleSaveDomainSettings);
    }
    // タブキーボードナビゲーション用イベントリスナー
    const tabList = document.getElementById('tabList');
    if (tabList) {
        const tabs = tabList.querySelectorAll('[role="tab"]');
        const handleTabKeydown = (e) => {
            const currentIndex = Array.from(tabs).indexOf(document.activeElement);
            switch (e.key) {
                case 'ArrowRight':
                    e.preventDefault();
                    tabs[(currentIndex + 1) % tabs.length].focus();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    tabs[(currentIndex - 1 + tabs.length) % tabs.length].focus();
                    break;
                case 'Home':
                    e.preventDefault();
                    tabs[0].focus();
                    break;
                case 'End':
                    e.preventDefault();
                    tabs[tabs.length - 1].focus();
                    break;
                case 'Enter':
                case ' ':
                    e.preventDefault();
                    document.activeElement.click();
                    break;
            }
        };
        tabList.addEventListener('keydown', handleTabKeydown);
    }
    // Load domain settings
    loadDomainSettings();
}
function showTab(tabName) {
    // Buttons
    const tabBtns = [
        { btn: generalTabBtn, name: 'general' },
        { btn: domainTabBtn, name: 'domain' },
        { btn: promptTabBtn, name: 'prompt' },
        { btn: privacyTabBtn, name: 'privacy' },
    ];
    tabBtns.forEach(({ btn, name }) => {
        if (btn) {
            btn.classList.toggle('active', name === tabName);
            btn.setAttribute('aria-selected', String(name === tabName));
        }
    });
    // Panels - CSSクラスのみで制御（インラインスタイルを使わない）
    const tabPanels = [
        { panel: generalPanel, name: 'general' },
        { panel: domainPanel, name: 'domain' },
        { panel: promptPanel, name: 'prompt' },
        { panel: privacyPanel, name: 'privacy' },
    ];
    tabPanels.forEach(({ panel, name }) => {
        if (panel) {
            const isActive = name === tabName;
            panel.classList.toggle('active', isActive);
            panel.removeAttribute('style');
            panel.setAttribute('aria-hidden', String(!isActive));
        }
    });
    // Move focus to first focusable element in newly activated panel
    const activePanel = tabName === 'general' ? generalPanel :
        tabName === 'domain' ? domainPanel :
            tabName === 'prompt' ? promptPanel :
                privacyPanel;
    if (activePanel) {
        const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
        const firstFocusable = activePanel.querySelector(focusableSelector);
        if (firstFocusable) {
            firstFocusable.focus();
        }
    }
}
function updateDomainListVisibility() {
    const checkedRadio = document.querySelector('input[name="domainFilter"]:checked');
    if (!checkedRadio)
        return;
    const mode = checkedRadio.value;
    if (domainListSection && domainListLabel && domainListTextarea) {
        if (mode === 'disabled') {
            domainListSection.style.display = 'none';
        }
        else {
            domainListSection.style.display = 'block';
            // Update label and load appropriate list
            if (mode === 'whitelist') {
                domainListLabel.textContent = getMessage('whitelistLabel') || 'Whitelist (1 domain per line)';
                if (whitelistTextarea) {
                    domainListTextarea.value = whitelistTextarea.value;
                }
            }
            else if (mode === 'blacklist') {
                domainListLabel.textContent = getMessage('blacklistLabel') || 'Blacklist (1 domain per line)';
                if (blacklistTextarea) {
                    domainListTextarea.value = blacklistTextarea.value;
                }
            }
        }
    }
}
/**
 * フォーマットUIの切替
 */
export function toggleFormatUI() {
    if (simpleFormatUI && simpleFormatEnabledCheckbox) {
        simpleFormatUI.style.display = simpleFormatEnabledCheckbox.checked ? 'block' : 'none';
    }
    if (uBlockFormatUI && ublockFormatEnabledCheckbox) {
        uBlockFormatUI.style.display = ublockFormatEnabledCheckbox.checked ? 'block' : 'none';
    }
}
export async function loadDomainSettings() {
    const settings = await getSettings();
    // Load filter mode
    // Validate mode to prevent CSS selector injection (only allow: disabled, whitelist, blacklist)
    const ALLOWED_FILTER_MODES = ['disabled', 'whitelist', 'blacklist'];
    const rawMode = settings[StorageKeys.DOMAIN_FILTER_MODE] || 'disabled';
    const mode = ALLOWED_FILTER_MODES.includes(rawMode) ? rawMode : 'disabled';
    const modeRadio = document.querySelector(`input[name="domainFilter"][value="${mode}"]`);
    if (modeRadio) {
        modeRadio.checked = true;
    }
    // Load domain list based on mode
    let domainList = [];
    if (mode === 'whitelist') {
        domainList = settings[StorageKeys.DOMAIN_WHITELIST] || [];
    }
    else if (mode === 'blacklist') {
        domainList = settings[StorageKeys.DOMAIN_BLACKLIST] || [];
    }
    // Store in hidden textareas for later saving
    if (whitelistTextarea) {
        whitelistTextarea.value = (settings[StorageKeys.DOMAIN_WHITELIST] || []).join('\n');
    }
    if (blacklistTextarea) {
        blacklistTextarea.value = (settings[StorageKeys.DOMAIN_BLACKLIST] || []).join('\n');
    }
    // Display in main textarea
    if (domainListTextarea) {
        domainListTextarea.value = domainList.join('\n');
    }
    updateDomainListVisibility();
    // フィルター形式の読み込み
    if (simpleFormatEnabledCheckbox) {
        simpleFormatEnabledCheckbox.checked = settings[StorageKeys.SIMPLE_FORMAT_ENABLED] !== false;
    }
    if (ublockFormatEnabledCheckbox) {
        ublockFormatEnabledCheckbox.checked = settings[StorageKeys.UBLOCK_FORMAT_ENABLED] === true;
    }
    // Always call toggleFormatUI to ensure correct UI state
    toggleFormatUI();
}
// addCurrentDomain function removed - users can now add domains via status panel buttons
export async function handleSaveDomainSettings() {
    try {
        // シンプル形式の保存
        await saveSimpleFormatSettings();
        // uBlock形式の保存
        await handleSaveUblockSettings();
    }
    catch (error) {
        addLog(LogType.ERROR, 'Error saving domain settings', { error: error.message, stack: error.stack });
        showStatus('domainStatus', `${getMessage('saveError')}: ${error.message}`, 'error');
    }
}
/**
 * シンプル形式の設定を保存
 */
async function saveSimpleFormatSettings() {
    // Check if filter mode is selected
    const selectedMode = document.querySelector('input[name="domainFilter"]:checked');
    if (!selectedMode) {
        showStatus('domainStatus', getMessage('filterModeRequired'), 'error');
        return;
    }
    const mode = selectedMode.value;
    // Save current textarea content to appropriate hidden textarea
    if (domainListTextarea && whitelistTextarea && blacklistTextarea) {
        if (mode === 'whitelist') {
            whitelistTextarea.value = domainListTextarea.value;
        }
        else if (mode === 'blacklist') {
            blacklistTextarea.value = domainListTextarea.value;
        }
    }
    // Read both lists from hidden textareas
    const whitelistText = whitelistTextarea?.value.trim() || '';
    const blacklistText = blacklistTextarea?.value.trim() || '';
    const whitelist = whitelistText ? parseDomainList(whitelistText) : [];
    const blacklist = blacklistText ? parseDomainList(blacklistText) : [];
    // Validate the current mode's list
    const currentList = mode === 'whitelist' ? whitelist : blacklist;
    if (mode !== 'disabled' && currentList.length > 0) {
        const errors = validateDomainList(currentList);
        if (errors.length > 0) {
            showStatus('domainStatus', `${getMessage('domainListError')}\n${errors.join('\n')}`, 'error');
            return;
        }
    }
    // Prepare settings object - save both lists
    const newSettings = {
        [StorageKeys.DOMAIN_FILTER_MODE]: mode,
        [StorageKeys.SIMPLE_FORMAT_ENABLED]: simpleFormatEnabledCheckbox?.checked,
        [StorageKeys.DOMAIN_WHITELIST]: whitelist,
        [StorageKeys.DOMAIN_BLACKLIST]: blacklist
    };
    // Save settings
    try {
        await saveSettings(newSettings, true);
        showStatus('domainStatus', getMessage('domainFilterSaved'), 'success');
    }
    catch (error) {
        addLog(LogType.ERROR, 'Error saving to Chrome Storage', { error: error.message });
        showStatus('domainStatus', `${getMessage('saveError')}: ${error.message}`, 'error');
    }
}
//# sourceMappingURL=domainFilter.js.map