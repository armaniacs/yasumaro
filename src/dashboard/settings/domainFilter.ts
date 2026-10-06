/**
 * domainFilter.ts
 * Domain filter settings functionality for the popup UI.
 */

import { settingsRepository } from '../../utils/storage/SettingsRepository.js';
import { StorageKeys } from '../../utils/storage/types.js';
import type { Settings } from '../../utils/storage/types.js';
import { saveSettingsAndRefreshDomainFilterCache } from '../../utils/storage/domainFilterCache.js';
import { errorMessage } from '../../utils/errorUtils.js';
import { DomainFilter } from '../../utils/domainFilter/DomainFilter.js';
import { parseDomainList } from '../../utils/domainUtils.js';
import { init as initUblockImport, handleSaveUblockSettings } from './ublockImport/index.js';
import { LogType } from '../../utils/logger/types.js';
import { addLog } from '../../utils/logger/core.js';
import { showStatus } from '../../utils/ui/settingsUiHelper.js';
import { getMessage, getMessageOr } from '../../utils/i18n.js';

interface DomainFilterDom {
    filterDisabledRadio: HTMLInputElement | null;
    filterWhitelistRadio: HTMLInputElement | null;
    filterBlacklistRadio: HTMLInputElement | null;
    domainListSection: HTMLElement | null;
    domainListLabel: HTMLElement | null;
    domainListTextarea: HTMLTextAreaElement | null;
    whitelistTextarea: HTMLTextAreaElement | null;
    blacklistTextarea: HTMLTextAreaElement | null;
    saveDomainSettingsBtn: HTMLElement | null;
    simpleFormatEnabledCheckbox: HTMLInputElement | null;
    ublockFormatEnabledCheckbox: HTMLInputElement | null;
    simpleFormatUI: HTMLElement | null;
    uBlockFormatUI: HTMLElement | null;
}

export interface DomainFilterController {
    /** Wire the filter radios, format toggles and save button. Re-resolves the DOM first. */
    init(): void;
    /** Re-read persisted domain settings into the panel. */
    loadDomainSettings(): Promise<void>;
    /** Validate and persist both domain lists. */
    saveDomainLists(): Promise<{ ok: boolean; message: string }>;
    /** Switch simple/uBlock format UI visibility. */
    toggleFormatUI(): void;
    /** Save simple-format and uBlock-format settings with status output. */
    handleSaveDomainSettings(): Promise<void>;
    /**
     * Detach every listener this instance attached and drop every element
     * reference. A later init() re-resolves from the document.
     */
    destroy(): void;
}

export function createDomainFilter(): DomainFilterController {
    let dom: DomainFilterDom | null = null;
    /** Removers for every listener init() attached, in attach order. */
    const teardown: Array<() => void> = [];

    /**
     * Resolve all DOM references. Called at the top of init() and lazily by
     * the other entries so importing this module never touches `document`.
     */
    function resolveDom(): void {
        dom = {
            filterDisabledRadio: document.getElementById('filterDisabled') as HTMLInputElement | null,
            filterWhitelistRadio: document.getElementById('filterWhitelist') as HTMLInputElement | null,
            filterBlacklistRadio: document.getElementById('filterBlacklist') as HTMLInputElement | null,
            domainListSection: document.getElementById('domainListSection'),
            domainListLabel: document.getElementById('domainListLabel'),
            domainListTextarea: document.getElementById('domainList') as HTMLTextAreaElement | null,
            whitelistTextarea: document.getElementById('whitelistTextarea') as HTMLTextAreaElement | null,
            blacklistTextarea: document.getElementById('blacklistTextarea') as HTMLTextAreaElement | null,
            saveDomainSettingsBtn: document.getElementById('saveDomainSettings'),
            simpleFormatEnabledCheckbox: document.getElementById('simpleFormatEnabled') as HTMLInputElement | null,
            ublockFormatEnabledCheckbox: document.getElementById('ublockFormatEnabled') as HTMLInputElement | null,
            simpleFormatUI: document.getElementById('simpleFormatUI'),
            uBlockFormatUI: document.getElementById('uBlockFormatUI'),
        };
    }

    /** Resolve on first use so direct calls work without init(). */
    function ensureDom(): void {
        if (!dom) resolveDom();
    }

    /** Attach a listener and record how to undo it, so destroy() is complete. */
    function listen(target: EventTarget | null | undefined, type: string, handler: EventListenerOrEventListenerObject): void {
        if (!target) return;
        target.addEventListener(type, handler);
        teardown.push(() => target.removeEventListener(type, handler));
    }

    function updateDomainListVisibility(): void {
        ensureDom();
        const { domainListSection, domainListLabel, domainListTextarea, whitelistTextarea, blacklistTextarea } = dom ?? {};
        // 新タグ UI（domainTagArea）が存在する場合は旧 UI を表示しない。
        // 旧 textarea セクションが新タグ UI と二重に表示され、空の保存ボタンが
        // 漏出するのを防ぐ（画像の紫の空ボタンの原因）。
        if (document.getElementById('domainTagArea')) {
            if (domainListSection) domainListSection.style.display = 'none';
            return;
        }

        const checkedRadio = document.querySelector('input[name="domainFilter"]:checked') as HTMLInputElement | null;
        if (!checkedRadio) return;

        const mode = checkedRadio.value;

        if (domainListSection && domainListLabel && domainListTextarea) {
            if (mode === 'disabled') {
                domainListSection.style.display = 'none';
            } else {
                domainListSection.style.display = 'block';

                // Update label and load appropriate list
                if (mode === 'whitelist') {
                    domainListLabel.textContent = getMessageOr('whitelistLabel', 'Whitelist (1 domain per line)');
                    if (whitelistTextarea) {
                        domainListTextarea.value = whitelistTextarea.value;
                    }
                } else if (mode === 'blacklist') {
                    domainListLabel.textContent = getMessageOr('blacklistLabel', 'Blacklist (1 domain per line)');
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
    function toggleFormatUI(): void {
        ensureDom();
        const { simpleFormatUI, simpleFormatEnabledCheckbox, uBlockFormatUI, ublockFormatEnabledCheckbox } = dom ?? {};
        // 新タグ UI が存在する場合は旧 simpleFormatUI を常に非表示にする。
        // 旧 UI の textarea と保存ボタンが新 UI と二重に表示されるのを防ぐ。
        if (document.getElementById('domainTagArea')) {
            if (simpleFormatUI) simpleFormatUI.style.display = 'none';
        } else if (simpleFormatUI && simpleFormatEnabledCheckbox) {
            simpleFormatUI.style.display = simpleFormatEnabledCheckbox.checked ? 'block' : 'none';
        }
        if (uBlockFormatUI && ublockFormatEnabledCheckbox) {
            uBlockFormatUI.style.display = ublockFormatEnabledCheckbox.checked ? 'block' : 'none';
        }
    }

    async function loadDomainSettings(): Promise<void> {
        ensureDom();
        const settings = await settingsRepository.getAll();

        // Load filter mode
        // Validate mode to prevent CSS selector injection (only allow: disabled, whitelist, blacklist)
        const ALLOWED_FILTER_MODES = ['disabled', 'whitelist', 'blacklist'];
        const rawMode = settings[StorageKeys.DOMAIN_FILTER_MODE] || 'disabled';
        const mode = ALLOWED_FILTER_MODES.includes(rawMode) ? rawMode : 'disabled';

        const modeRadio = document.querySelector(`input[name="domainFilter"][value="${mode}"]`) as HTMLInputElement | null;
        if (modeRadio) {
            modeRadio.checked = true;
        }

        // Load domain list based on mode
        let domainList: string[] = [];
        if (mode === 'whitelist') {
            domainList = settings[StorageKeys.DOMAIN_WHITELIST] || [];
        } else if (mode === 'blacklist') {
            domainList = settings[StorageKeys.DOMAIN_BLACKLIST] || [];
        }

        // Store in hidden textareas for later saving
        if (dom?.whitelistTextarea) {
            dom.whitelistTextarea.value = (settings[StorageKeys.DOMAIN_WHITELIST] || []).join('\n');
        }
        if (dom?.blacklistTextarea) {
            dom.blacklistTextarea.value = (settings[StorageKeys.DOMAIN_BLACKLIST] || []).join('\n');
        }

        // Display in main textarea
        if (dom?.domainListTextarea) {
            dom.domainListTextarea.value = domainList.join('\n');
        }

        // Subdomain auto-matching toggle (PBI 2026-09-06-06) — default OFF
        const subdomainToggle = document.getElementById('domainSubdomainToggle') as HTMLInputElement | null;
        if (subdomainToggle) {
            subdomainToggle.checked = settings[StorageKeys.DOMAIN_SUBDOMAIN_MATCHING] === true;
            subdomainToggle.setAttribute('aria-checked', String(subdomainToggle.checked));
        }

        updateDomainListVisibility();

        // フィルター形式の読み込み
        if (dom?.simpleFormatEnabledCheckbox) {
            dom.simpleFormatEnabledCheckbox.checked = settings[StorageKeys.SIMPLE_FORMAT_ENABLED] !== false;
        }
        if (dom?.ublockFormatEnabledCheckbox) {
            dom.ublockFormatEnabledCheckbox.checked = settings[StorageKeys.UBLOCK_FORMAT_ENABLED] === true;
        }

        // Always call toggleFormatUI to ensure correct UI state
        toggleFormatUI();
    }

    // addCurrentDomain function removed - users can now add domains via status panel buttons

    async function handleSaveDomainSettings(): Promise<void> {
        try {
            // シンプル形式の保存
            await saveSimpleFormatSettings();

            // uBlock形式の保存
            await handleSaveUblockSettings();

        } catch (error: unknown) {
            const errorStack = error instanceof Error ? error.stack : undefined;
            addLog(LogType.ERROR, 'Error saving domain settings', { error: errorMessage(error), stack: errorStack });
            showStatus('domainStatus', `${getMessage('saveError')}: ${errorMessage(error)}`, 'error');
        }
    }

    /**
     * Save the domain lists and report the outcome as a value (PBI 2026-09-12-15).
     *
     * The tag UI used to click the hidden save button and transcribe the status
     * through a MutationObserver on the hidden status node — a DOM-node contract
     * instead of an interface. Both the legacy button path and the tag UI now
     * call this seam and render the returned message themselves.
     */
    async function saveDomainLists(): Promise<{ ok: boolean; message: string }> {
        ensureDom();
        // Check if filter mode is selected
        const selectedMode = document.querySelector('input[name="domainFilter"]:checked') as HTMLInputElement | null;
        if (!selectedMode) {
            return { ok: false, message: getMessage('filterModeRequired') };
        }

        const mode = selectedMode.value;

        // Save current textarea content to appropriate hidden textarea
        if (dom?.domainListTextarea && dom?.whitelistTextarea && dom?.blacklistTextarea) {
            if (mode === 'whitelist') {
                dom.whitelistTextarea.value = dom.domainListTextarea.value;
            } else if (mode === 'blacklist') {
                dom.blacklistTextarea.value = dom.domainListTextarea.value;
            }
        }

        // Read both lists from hidden textareas — textarea is the sole UI seam,
        // DomainFilter.parseAndValidate is the sole validation seam (syntax check
        // via isValidDomain + ReDoS guard via wildcardToRegex).
        const filter = new DomainFilter();
        const whitelistText = dom?.whitelistTextarea?.value.trim() || '';
        const blacklistText = dom?.blacklistTextarea?.value.trim() || '';

        const whitelist = whitelistText ? parseDomainList(whitelistText) : [];
        const blacklist = blacklistText ? parseDomainList(blacklistText) : [];

        // Validate BOTH lists, not just the active mode's. Both are persisted below,
        // and an unvalidated pattern in the inactive list is still evaluated later
        // when the user switches modes (via isDomainAllowed → matchesPattern).
        // A pattern with excessive wildcards or bad syntax must never reach storage
        // (VULN-025 / VULN-026). DomainFilter.parseAndValidate covers both.
        const wlRes = filter.parseAndValidate(whitelist);
        const blRes = filter.parseAndValidate(blacklist);
        const errors = [...wlRes.errors, ...blRes.errors];
        if (errors.length > 0) {
            return { ok: false, message: `${getMessage('domainListError')}\n${errors.join('\n')}` };
        }

        // Prepare settings delta - save both lists
        const subdomainToggle = document.getElementById('domainSubdomainToggle') as HTMLInputElement | null;
        const newSettings: Partial<Settings> = {
            [StorageKeys.DOMAIN_FILTER_MODE]: mode,
            // Only include the toggle when its checkbox exists — writing a
            // fallback `false` would clobber a stored `true` on a DOM-miss.
            ...(dom?.simpleFormatEnabledCheckbox
                ? { [StorageKeys.SIMPLE_FORMAT_ENABLED]: dom.simpleFormatEnabledCheckbox.checked }
                : {}),
            [StorageKeys.DOMAIN_WHITELIST]: whitelist,
            [StorageKeys.DOMAIN_BLACKLIST]: blacklist,
            [StorageKeys.DOMAIN_SUBDOMAIN_MATCHING]: subdomainToggle?.checked === true
        }

        // Save settings — delta write + cache refresh via the shared seam
        // (PBI 2026-09-17-17; replaces the copy-pasted setAll+update IIFE)
        try {
            await saveSettingsAndRefreshDomainFilterCache(newSettings);
            return { ok: true, message: getMessage('domainFilterSaved') };
        } catch (error: unknown) {
            addLog(LogType.ERROR, 'Error saving to Chrome Storage', { error: errorMessage(error) });
            return { ok: false, message: `${getMessage('saveError')}: ${errorMessage(error)}` };
        }
    }

    /**
     * シンプル形式の設定を保存
     */
    async function saveSimpleFormatSettings(): Promise<void> {
        const { ok, message } = await saveDomainLists();
        showStatus('domainStatus', message, ok ? 'success' : 'error');
    }

    function init(): void {
        destroy();
        resolveDom();
        const {
            filterDisabledRadio, filterWhitelistRadio, filterBlacklistRadio,
            saveDomainSettingsBtn,
            simpleFormatEnabledCheckbox, ublockFormatEnabledCheckbox,
        } = dom ?? {};

        // Domain filter mode change
        if (filterDisabledRadio && filterWhitelistRadio && filterBlacklistRadio) {
            const radios = [filterDisabledRadio, filterWhitelistRadio, filterBlacklistRadio];
            for (const radio of radios) {
                listen(radio, 'change', () => updateDomainListVisibility());
            }
        }

        // フィルター形式切替
        if (simpleFormatEnabledCheckbox && ublockFormatEnabledCheckbox) {
            listen(simpleFormatEnabledCheckbox, 'change', () => toggleFormatUI());
            listen(ublockFormatEnabledCheckbox, 'change', () => toggleFormatUI());
        }

        // uBlock形式の初期化
        if (typeof initUblockImport === 'function') {
            initUblockImport();
        }

        // Save domain settings
        if (saveDomainSettingsBtn) {
            listen(saveDomainSettingsBtn, 'click', (() => { void handleSaveDomainSettings(); }) as EventListener);
        }

        // Load domain settings
        void loadDomainSettings();
    }

    function destroy(): void {
        for (const off of teardown.splice(0)) off();
        dom = null;
    }

    return {
        init,
        loadDomainSettings,
        saveDomainLists,
        toggleFormatUI,
        handleSaveDomainSettings,
        destroy,
    };
}

/**
 * The instance the module-level functions below delegate to. One per page is
 * the whole reason this module is a singleton today; `createDomainFilter`
 * exists so a test (or a second mount) can hold an isolated one instead.
 */
const sharedFilter = createDomainFilter();

export function init(): void {
    sharedFilter.init();
}

export function loadDomainSettings(): Promise<void> {
    return sharedFilter.loadDomainSettings();
}

export function toggleFormatUI(): void {
    sharedFilter.toggleFormatUI();
}

export function handleSaveDomainSettings(): Promise<void> {
    return sharedFilter.handleSaveDomainSettings();
}

export function saveDomainLists(): Promise<{ ok: boolean; message: string }> {
    return sharedFilter.saveDomainLists();
}

export function destroyDomainFilter(): void {
    sharedFilter.destroy();
}
