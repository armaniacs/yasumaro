/**
 * domainFilter.ts
 * Domain filter settings functionality for the popup UI.
 */

import { StorageKeys, getSettings, saveSettings } from '../utils/storage.js';
import { extractDomain, parseDomainList, validateDomainList } from '../utils/domainUtils.js';
// @ts-ignore: ublockImport/index.js might not be converted yet or type definitions missing
import { init as initUblockImport, handleSaveUblockSettings } from './ublockImport.js';
import { addLog, LogType } from '../utils/logger.js';
import { getCurrentTab, isRecordable } from './tabUtils.js';
import { showStatus } from './settingsUiHelper.js';
import { getMessage } from './i18n.js';

// Elements
const generalTabBtn = document.getElementById('generalTab');
const domainTabBtn = document.getElementById('domainTab');
const privacyTabBtn = document.getElementById('privacyTab'); // Phase 3

const generalPanel = document.getElementById('generalPanel');
const domainPanel = document.getElementById('domainPanel');
const privacyPanel = document.getElementById('privacyPanel'); // Phase 3

// Domain filter elements
const filterDisabledRadio = document.getElementById('filterDisabled') as HTMLInputElement | null;
const filterWhitelistRadio = document.getElementById('filterWhitelist') as HTMLInputElement | null;
const filterBlacklistRadio = document.getElementById('filterBlacklist') as HTMLInputElement | null;
const domainListSection = document.getElementById('domainListSection');
const domainListLabel = document.getElementById('domainListLabel');
const domainListTextarea = document.getElementById('domainList') as HTMLTextAreaElement | null;
const addCurrentDomainBtn = document.getElementById('addCurrentDomain');
const saveDomainSettingsBtn = document.getElementById('saveDomainSettings');

// uBlock形式要素
const simpleFormatEnabledCheckbox = document.getElementById('simpleFormatEnabled') as HTMLInputElement | null;
const ublockFormatEnabledCheckbox = document.getElementById('ublockFormatEnabled') as HTMLInputElement | null;
const simpleFormatUI = document.getElementById('simpleFormatUI');
const uBlockFormatUI = document.getElementById('uBlockFormatUI');

// Tab switching functionality
export function init(): void {
    // Tab switching
    if (generalTabBtn) {
        generalTabBtn.addEventListener('click', () => {
            showTab('general');
        });
    }

    if (domainTabBtn) {
        domainTabBtn.addEventListener('click', () => {
            showTab('domain');
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

    // Add current domain button
    if (addCurrentDomainBtn) {
        addCurrentDomainBtn.addEventListener('click', addCurrentDomain);
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

        const handleTabKeydown = (e: KeyboardEvent) => {
            const currentIndex = Array.from(tabs).indexOf(document.activeElement as Element);

            switch (e.key) {
                case 'ArrowRight':
                    e.preventDefault();
                    (tabs[(currentIndex + 1) % tabs.length] as HTMLElement).focus();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    (tabs[(currentIndex - 1 + tabs.length) % tabs.length] as HTMLElement).focus();
                    break;
                case 'Home':
                    e.preventDefault();
                    (tabs[0] as HTMLElement).focus();
                    break;
                case 'End':
                    e.preventDefault();
                    (tabs[tabs.length - 1] as HTMLElement).focus();
                    break;
                case 'Enter':
                case ' ':
                    e.preventDefault();
                    (document.activeElement as HTMLElement).click();
                    break;
            }
        };

        tabList.addEventListener('keydown', handleTabKeydown);
    }

    // Load domain settings
    loadDomainSettings();
}

function showTab(tabName: 'general' | 'domain' | 'privacy'): void {
    // Buttons
    if (generalTabBtn) {
        generalTabBtn.classList.toggle('active', tabName === 'general');
        generalTabBtn.setAttribute('aria-selected', String(tabName === 'general'));
    }

    if (domainTabBtn) {
        domainTabBtn.classList.toggle('active', tabName === 'domain');
        domainTabBtn.setAttribute('aria-selected', String(tabName === 'domain'));
    }

    if (privacyTabBtn) {
        privacyTabBtn.classList.toggle('active', tabName === 'privacy');
        privacyTabBtn.setAttribute('aria-selected', String(tabName === 'privacy'));
    }

    // Panels - Panel visibility with aria-hidden for accessibility
    const isActiveGeneral = tabName === 'general';
    const isActiveDomain = tabName === 'domain';
    const isActivePrivacy = tabName === 'privacy';

    if (generalPanel) {
        generalPanel.classList.toggle('active', isActiveGeneral);
        generalPanel.style.display = isActiveGeneral ? 'block' : 'none';
        generalPanel.setAttribute('aria-hidden', String(!isActiveGeneral));
    }

    if (domainPanel) {
        domainPanel.classList.toggle('active', isActiveDomain);
        domainPanel.style.display = isActiveDomain ? 'block' : 'none';
        domainPanel.setAttribute('aria-hidden', String(!isActiveDomain));
    }

    if (privacyPanel) {
        privacyPanel.classList.toggle('active', isActivePrivacy);
        privacyPanel.style.display = isActivePrivacy ? 'block' : 'none';
        privacyPanel.setAttribute('aria-hidden', String(!isActivePrivacy));
    }

    // Move focus to first focusable element in newly activated panel
    const activePanel = tabName === 'general' ? generalPanel :
        tabName === 'domain' ? domainPanel :
            privacyPanel;

    if (activePanel) {
        const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
        const firstFocusable = activePanel.querySelector(focusableSelector) as HTMLElement;

        if (firstFocusable) {
            firstFocusable.focus();
        }
    }
}

function updateDomainListVisibility(): void {
    const checkedRadio = document.querySelector('input[name="domainFilter"]:checked') as HTMLInputElement | null;
    if (!checkedRadio) return;

    const mode = checkedRadio.value;

    if (domainListSection && domainListLabel) {
        if (mode === 'disabled') {
            domainListSection.style.display = 'none';
        } else {
            domainListSection.style.display = 'block';

            if (mode === 'whitelist') {
                domainListLabel.textContent = getMessage('domainList');
            } else if (mode === 'blacklist') {
                domainListLabel.textContent = getMessage('domainList');
            }
        }
    }
}

/**
 * フォーマットUIの切替
 */
export function toggleFormatUI(): void {
    if (simpleFormatUI && simpleFormatEnabledCheckbox) {
        simpleFormatUI.style.display = simpleFormatEnabledCheckbox.checked ? 'block' : 'none';
    }
    if (uBlockFormatUI && ublockFormatEnabledCheckbox) {
        uBlockFormatUI.style.display = ublockFormatEnabledCheckbox.checked ? 'block' : 'none';
    }
}

export async function loadDomainSettings(): Promise<void> {
    const settings = await getSettings();

    // Load filter mode
    const mode = settings[StorageKeys.DOMAIN_FILTER_MODE] || 'disabled';
    const modeRadio = document.querySelector(`input[name="domainFilter"][value="${mode}"]`) as HTMLInputElement | null;
    if (modeRadio) {
        modeRadio.checked = true;
    }

    // Load domain list
    let domainList: string[] = [];
    if (mode === 'whitelist') {
        domainList = settings[StorageKeys.DOMAIN_WHITELIST] || [];
    } else if (mode === 'blacklist') {
        domainList = settings[StorageKeys.DOMAIN_BLACKLIST] || [];
    }

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

    toggleFormatUI();
}

async function addCurrentDomain(): Promise<void> {
    try {
        const tab = await getCurrentTab();

        if (!tab) {
            showStatus('domainStatus', getMessage('noActiveTab'), 'error');
            return;
        }

        if (!isRecordable(tab)) {
            showStatus('domainStatus', getMessage('cannotRecordHttpHttps'), 'error');
            return;
        }

        const domain = extractDomain(tab.url || '');
        if (!domain) {
            showStatus('domainStatus', getMessage('failedToExtractDomain'), 'error');
            return;
        }

        // Get current list
        if (!domainListTextarea) return;
        const currentList = parseDomainList(domainListTextarea.value);

        // Check for duplicates
        if (currentList.includes(domain)) {
            showStatus('domainStatus', getMessage('domainAlreadyExists', { domain }), 'error');
            return;
        }

        // Add domain to list
        currentList.push(domain);
        domainListTextarea.value = currentList.join('\n');

        showStatus('domainStatus', getMessage('domainAdded', { domain }), 'success');
    } catch (error: any) {
        addLog(LogType.ERROR, 'Error adding current domain', { error: error.message });
        showStatus('domainStatus', `${getMessage('errorColon')} ${error.message}`, 'error');
    }
}

export async function handleSaveDomainSettings(): Promise<void> {
    try {
        // シンプル形式の保存
        await saveSimpleFormatSettings();

        // uBlock形式の保存
        await handleSaveUblockSettings();

    } catch (error: any) {
        addLog(LogType.ERROR, 'Error saving domain settings', { error: error.message, stack: error.stack });
        showStatus('domainStatus', `${getMessage('saveError')}: ${error.message}`, 'error');
    }
}

/**
 * シンプル形式の設定を保存
 */
async function saveSimpleFormatSettings(): Promise<void> {
    // Check if filter mode is selected
    const selectedMode = document.querySelector('input[name="domainFilter"]:checked') as HTMLInputElement | null;
    if (!selectedMode) {
        showStatus('domainStatus', getMessage('filterModeRequired'), 'error');
        return;
    }

    const mode = selectedMode.value;
    if (!domainListTextarea) return;
    const domainListText = domainListTextarea.value.trim();
    const domainList = domainListText ? parseDomainList(domainListText) : [];

    // Validate domain list if not disabled
    if (mode !== 'disabled' && domainList.length > 0) {
        const errors = validateDomainList(domainList);
        if (errors.length > 0) {
            showStatus('domainStatus', `${getMessage('domainListError')}\n${errors.join('\n')}`, 'error');
            return;
        }
    }

    // Prepare settings object
    const newSettings: any = {
        [StorageKeys.DOMAIN_FILTER_MODE]: mode,
        [StorageKeys.SIMPLE_FORMAT_ENABLED]: simpleFormatEnabledCheckbox?.checked
    };

    if (mode === 'whitelist') {
        newSettings[StorageKeys.DOMAIN_WHITELIST] = domainList;
    } else if (mode === 'blacklist') {
        newSettings[StorageKeys.DOMAIN_BLACKLIST] = domainList;
    }

    // Save settings
    try {
        await saveSettings(newSettings, true);
        showStatus('domainStatus', getMessage('domainFilterSaved'), 'success');
    } catch (error: any) {
        addLog(LogType.ERROR, 'Error saving to Chrome Storage', { error: error.message });
        showStatus('domainStatus', `${getMessage('saveError')}: ${error.message}`, 'error');
    }
}

