/**
 * trustSettings.ts
 * Trust Database 設定管理モジュール（Phase 1）
 * Dashboard TrustパネルのUIロジック
 *
 * WHY a factory: 22 個の DOM 要素参照と `currentCategory` が module-level の
 * `let` で、同じ document を再利用するテストでは前回 init のノードが持ち越され
 * た。状態は createTrustSettings() のインスタンスが保持し、`destroy()` が
 * 参照とリスナをすべて解放する。module-level の関数は既存呼び出しのため残し、
 * 既定インスタンスへ委譲する。
 */

import type { TrancoTier, SafetyMode } from '../../utils/trustDb/trustDbSchema.js';
import { errorMessage } from '../../utils/errorUtils.js';
import { StorageKeys } from '../../utils/storage/types.js';
import { settingsRepository } from '../../utils/storage/SettingsRepository.js';
import { getTrustDbAdmin } from '../../utils/trustDb/TrustDbAdmin.js';
import { getTrancoUpdater } from '../../utils/trustDb/trancoUpdater.js';
import { ErrorCode } from '../../utils/logger/types.js';
import { logInfo, logError } from '../../utils/logger/api.js';
import { getMessageOr, getMessageWithSubstitutions } from '../../utils/i18n.js';
import { getPluralKey } from '../../utils/i18nPlural.js';
import { getTrustChecker } from '../../utils/trustChecker.js';
import { showStatus } from '../../utils/ui/settingsUiHelper.js';

export type TrustCategory = 'finance' | 'gaming' | 'sns';

export interface TrustPermissionSuggestEntry {
    domain: string;
    count: number;
}

interface TrustDom {
    safetyModeSelect: HTMLSelectElement | null;
    trancoTierSelect: HTMLSelectElement | null;
    trancoStatusDiv: HTMLElement | null;
    updateTrancoBtn: HTMLButtonElement | null;
    jpAnchorListDiv: HTMLElement | null;
    jpAnchorAddInput: HTMLInputElement | null;
    jpAnchorAddBtn: HTMLButtonElement | null;
    sensitiveListDiv: HTMLElement | null;
    sensitiveCategorySelect: HTMLSelectElement | null;
    sensitiveAddInput: HTMLInputElement | null;
    sensitiveAddBtn: HTMLButtonElement | null;
    whitelistDiv: HTMLElement | null;
    whitelistAddInput: HTMLInputElement | null;
    whitelistAddBtn: HTMLButtonElement | null;
    alertFinanceCheckbox: HTMLInputElement | null;
    alertSensitiveCheckbox: HTMLInputElement | null;
    alertUnverifiedCheckbox: HTMLInputElement | null;
    saveTrustSettingsBtn: HTMLButtonElement | null;
    trustSettingsStatusDiv: HTMLElement | null;
    thresholdInput: HTMLInputElement | null;
    categoryTabs: NodeListOf<HTMLButtonElement> | null;
}

export interface TrustSettingsController {
    /** Wire the panel's event listeners. Re-resolves the DOM first. */
    init(): void;
    /** Re-read persisted Trust settings and alert config into the panel. */
    loadTrustSettings(): Promise<void>;
    renderJpAnchorList(tlds: string[]): void;
    renderSensitiveList(domains: string[], isWhitelist?: boolean): void;
    renderPermissionSuggestList(): Promise<TrustPermissionSuggestEntry[]>;
    /**
     * Detach every listener this instance attached and drop every element
     * reference. A later init() re-resolves from the document, so a re-mount
     * after destroy() starts from a clean state.
     */
    destroy(): void;
}

export function createTrustSettings(): TrustSettingsController {
    // ============================================================================
    // Instance state (DOM Elements — lazy init: module scope must not touch
    // `document` so this module imports without a DOM)
    // ============================================================================

    let dom: TrustDom | null = null;
    let currentCategory: TrustCategory = 'finance';
    /** Removers for every listener init() attached, in attach order. */
    const teardown: Array<() => void> = [];

    /**
     * Resolve all DOM references. Called at the top of init() and
     * loadTrustSettings() so importing this module never touches `document`.
     */
    function resolveTrustDomElements(): void {
        dom = {
            safetyModeSelect: document.getElementById('safetyMode') as HTMLSelectElement | null,
            trancoTierSelect: document.getElementById('trancoTier') as HTMLSelectElement | null,
            trancoStatusDiv: document.getElementById('trancoStatus') as HTMLElement | null,
            updateTrancoBtn: document.getElementById('updateTrancoBtn') as HTMLButtonElement | null,
            jpAnchorListDiv: document.getElementById('jpAnchorList') as HTMLElement | null,
            jpAnchorAddInput: document.getElementById('jpAnchorAdd') as HTMLInputElement | null,
            jpAnchorAddBtn: document.getElementById('jpAnchorAddBtn') as HTMLButtonElement | null,
            sensitiveListDiv: document.getElementById('sensitiveList') as HTMLElement | null,
            sensitiveCategorySelect: document.getElementById('sensitiveCategory') as HTMLSelectElement | null,
            sensitiveAddInput: document.getElementById('sensitiveAdd') as HTMLInputElement | null,
            sensitiveAddBtn: document.getElementById('sensitiveAddBtn') as HTMLButtonElement | null,
            whitelistDiv: document.getElementById('whitelist') as HTMLElement | null,
            whitelistAddInput: document.getElementById('whitelistAdd') as HTMLInputElement | null,
            whitelistAddBtn: document.getElementById('whitelistAddBtn') as HTMLButtonElement | null,
            alertFinanceCheckbox: document.getElementById('alertFinance') as HTMLInputElement | null,
            alertSensitiveCheckbox: document.getElementById('alertSensitive') as HTMLInputElement | null,
            alertUnverifiedCheckbox: document.getElementById('alertUnverified') as HTMLInputElement | null,
            saveTrustSettingsBtn: document.getElementById('saveTrustSettings') as HTMLButtonElement | null,
            trustSettingsStatusDiv: document.getElementById('trustSettingsStatus') as HTMLElement | null,
            thresholdInput: document.getElementById('permissionThreshold') as HTMLInputElement | null,
            categoryTabs: document.querySelectorAll<HTMLButtonElement>('.category-tab'),
        };
    }

    /** Attach a listener and record how to undo it, so destroy() is complete. */
    function listen<T extends EventTarget>(
        target: T | null | undefined,
        type: string,
        handler: EventListenerOrEventListenerObject,
    ): void {
        if (!target) return;
        target.addEventListener(type, handler);
        teardown.push(() => target.removeEventListener(type, handler));
    }

    /** Status helper that tolerates a missing status element (pre-init calls). */
    function trustStatus(message: string, type: 'success' | 'error'): void {
        const statusDiv = dom?.trustSettingsStatusDiv;
        if (!statusDiv) return;
        showStatus(statusDiv, message, type);
    }

    // ============================================================================
    // Utility Functions
    // ============================================================================

    function updateTrancoStatus(status: {
        count?: number;
        lastUpdated?: string;
        tier?: string;
        updating?: boolean;
        error?: string;
    }): void {
        const statusDiv = dom?.trancoStatusDiv;
        if (!statusDiv) return;

        if (status.updating) {
            statusDiv.textContent = getMessageOr('trancoUpdating', 'Updating...');
            statusDiv.className = 'status-message updating';
            return;
        }

        if (status.error) {
            statusDiv.textContent = status.error;
            statusDiv.className = 'status-message error';
            return;
        }

        const count = status.count ?? 0;
        const lastUpdated = (status.lastUpdated ?? getMessageOr('trancoNotUpdated', 'Not updated')) || 'Not updated';
        const tierObj: Record<TrancoTier | string, string> = {
            top1k: getMessageOr('trancoTierTop1k', 'Top 1,000'),
            top10k: getMessageOr('trancoTierTop10k', 'Top 10,000'),
            top100k: getMessageOr('trancoTierTop100k', 'Top 100,000')};
        const tierLabel = tierObj[status.tier as TrancoTier] || status.tier || '';

        statusDiv.textContent = getMessageWithSubstitutions(getPluralKey('trancoStatusFormat', count), { count, tier: tierLabel, lastUpdated }, `Domains: ${count} | Tier: ${tierLabel} | Last updated: ${lastUpdated}`);
        statusDiv.className = 'status-message';
    }

    // ============================================================================
    // JP-Anchor List Management
    // ============================================================================

    function renderJpAnchorList(tlds: string[]): void {
        // Resolve on first use so direct calls work without init(); the import
        // itself still never touches `document`.
        if (!dom?.jpAnchorListDiv) resolveTrustDomElements();
        const listDiv = dom?.jpAnchorListDiv;
        if (!listDiv) return;
        listDiv.textContent = '';

        tlds.forEach(tld => {
            const div = document.createElement('div');
            div.className = 'domain-tag';

            // XSS-safe: Use createElement and textContent instead of innerHTML
            const span = document.createElement('span');
            span.textContent = tld;
            div.appendChild(span);

            const removeBtn = document.createElement('button');
            removeBtn.className = 'domain-tag-remove';
            removeBtn.textContent = '×';
            removeBtn.dataset.tld = tld;
            removeBtn.setAttribute('aria-label', `Remove ${tld}`);
            div.appendChild(removeBtn);

            listDiv.appendChild(div);

            removeBtn.addEventListener('click', () => {
                void removeJpAnchorTld(tld);
            });
        });
    }

    async function addJpAnchorTld(tld: string): Promise<void> {
        const db = getTrustDbAdmin();
        await db.initialize();

        const result = await db.addJpAnchorTld(tld);

        if (!result.success) {
            trustStatus(getMessageOr(result.error ?? '', result.error || 'Error'), 'error');
            return;
        }

        renderJpAnchorList(db.getJpAnchorTlds());
        if (dom?.jpAnchorAddInput) dom.jpAnchorAddInput.value = '';
        trustStatus(getMessageOr('jpAnchorAdded', 'TLD added'), 'success');
    }

    async function removeJpAnchorTld(tld: string): Promise<void> {
        const db = getTrustDbAdmin();
        await db.initialize();

        await db.removeJpAnchorTld(tld);
        renderJpAnchorList(db.getJpAnchorTlds());
    }

    // ============================================================================
    // Sensitive List Management
    // ============================================================================

    function renderSensitiveList(domains: string[], isWhitelist = false): void {
        // Resolve on first use so direct calls work without init(); the import
        // itself still never touches `document`.
        if (!dom?.sensitiveListDiv || !dom?.whitelistDiv) resolveTrustDomElements();
        const container = isWhitelist ? dom?.whitelistDiv : dom?.sensitiveListDiv;
        if (!container) return;
        container.textContent = '';

        domains.forEach(domain => {
            const div = document.createElement('div');
            div.className = 'domain-tag';

            // XSS-safe: Use createElement and textContent instead of innerHTML
            const span = document.createElement('span');
            span.textContent = domain;
            div.appendChild(span);

            const removeBtn = document.createElement('button');
            removeBtn.className = 'domain-tag-remove';
            removeBtn.textContent = '×';
            removeBtn.dataset.domain = domain;
            removeBtn.setAttribute('aria-label', `Remove ${domain}`);
            div.appendChild(removeBtn);

            container.appendChild(div);

            removeBtn.addEventListener('click', () => {
                if (isWhitelist) {
                    void removeWhitelistDomain(domain);
                } else {
                    void removeSensitiveDomain(domain, currentCategory);
                }
            });
        });
    }

    async function addSensitiveDomain(domain: string, category: TrustCategory): Promise<void> {
        const db = getTrustDbAdmin();
        await db.initialize();

        const result = await db.addSensitiveDomain(domain, category);

        if (!result.success) {
            trustStatus(getMessageOr(result.error ?? '', result.error || 'Error'), 'error');
            return;
        }

        if (category === currentCategory) {
            renderSensitiveList(db.getSensitiveDomains(category));
        }
        if (dom?.sensitiveAddInput) dom.sensitiveAddInput.value = '';
        trustStatus(getMessageOr('sensitiveAdded', 'Domain added'), 'success');
    }

    async function removeSensitiveDomain(domain: string, category: TrustCategory): Promise<void> {
        const db = getTrustDbAdmin();
        await db.initialize();

        await db.removeSensitiveDomain(domain);
        renderSensitiveList(db.getSensitiveDomains(category));
    }

    // ============================================================================
    // Whitelist Management
    // ============================================================================

    async function addWhitelistDomain(domain: string): Promise<void> {
        const db = getTrustDbAdmin();
        await db.initialize();

        const result = await db.addToWhitelist(domain);

        if (!result.success) {
            trustStatus(getMessageOr(result.error ?? '', result.error || 'Error'), 'error');
            return;
        }

        renderWhitelistList(db.getWhitelist());
        if (dom?.whitelistAddInput) dom.whitelistAddInput.value = '';
        trustStatus(getMessageOr('whitelistAdded', 'Domain added'), 'success');
    }

    function renderWhitelistList(domains: string[]): void {
        renderSensitiveList(domains, true);
    }

    async function removeWhitelistDomain(domain: string): Promise<void> {
        const db = getTrustDbAdmin();
        await db.initialize();

        await db.removeFromWhitelist(domain);
        renderWhitelistList(db.getWhitelist());
    }

    // ============================================================================
    // Tranco Update
    // ============================================================================

    async function updateTrancoList(): Promise<void> {
        const tierSelect = dom?.trancoTierSelect;
        if (!tierSelect) return;

        const tier = tierSelect.value as TrancoTier;
        const updater = getTrancoUpdater();

        if (updater.isUpdateInProgress()) {
            trustStatus(getMessageOr('trancoUpdateInProgress', 'Update already in progress'), 'error');
            return;
        }

        updateTrancoStatus({ updating: true });

        try {
            const result = await updater.updateTrancoList(tier);

            if (result.success) {
                await loadTrustSettings(); // Reload settings to reflect changes
                trustStatus(getMessageOr('trancoUpdateSuccess', 'Tranco list updated successfully'), 'success');
                logInfo('TrustSettings', { tier, count: result.domainsCount }, `Tranco update completed`);
            } else {
                logError('TrustSettings', { error: result.error }, ErrorCode.TRANCO_FETCH_FAILED);
                updateTrancoStatus({ error: result.error || 'Update failed' });
            }
        } catch (error) {
            logError('TrustSettings', { error: errorMessage(error) }, ErrorCode.TRANCO_FETCH_FAILED);
            updateTrancoStatus({ error: errorMessage(error) });
        }
    }

    // ============================================================================
    // Safety Mode & Tranco Tier Synchronization
    // ============================================================================

    function onSafetyModeChange(): void {
        const { safetyModeSelect, trancoTierSelect } = dom ?? {};
        if (!safetyModeSelect || !trancoTierSelect) return;

        const mode = safetyModeSelect.value as SafetyMode;
        const targetTier = SAFETY_MODE_TO_TIER[mode];

        trancoTierSelect.value = targetTier;
        trustStatus(getMessageOr('safetyModeChanged', 'Safety mode changed'), 'success');
    }

    function onTrancoTierChange(): void {
        const { safetyModeSelect, trancoTierSelect } = dom ?? {};
        if (!safetyModeSelect || !trancoTierSelect) return;

        const tier = trancoTierSelect.value as TrancoTier;
        const targetMode = TIER_TO_SAFETY_MODE[tier];

        safetyModeSelect.value = targetMode;
        updateTrancoStatus({ tier });
    }

    // ============================================================================
    // Category Tab Switching
    // ============================================================================

    function switchCategory(category: TrustCategory): void {
        currentCategory = category;

        dom?.categoryTabs?.forEach(tab => {
            if (tab.dataset.category === category) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });

        const db = getTrustDbAdmin();
        void db.initialize().then(() => {
            renderSensitiveList(db.getSensitiveDomains(category));
        });
    }

    // ============================================================================
    // Save Settings
    // ============================================================================

    async function saveTrustSettings(): Promise<void> {
        const { alertFinanceCheckbox, alertSensitiveCheckbox, alertUnverifiedCheckbox } = dom ?? {};
        const checker = getTrustChecker();
        await checker.saveAlertSettings({
            alertFinance: alertFinanceCheckbox?.checked ?? false,
            alertSensitive: alertSensitiveCheckbox?.checked ?? false,
            alertUnverified: alertUnverifiedCheckbox?.checked ?? false
        });

        // Note: Trust Database changes are already saved immediately when modified
        trustStatus(getMessageOr('settingsSaved', 'Settings saved'), 'success');
        const alertConfig = await checker.getAlertConfig();
        logInfo('TrustSettings', { alertConfig }, 'Trust settings saved');
    }

    // ============================================================================
    // Load Settings
    // ============================================================================

    async function loadTrustSettings(): Promise<void> {
        resolveTrustDomElements();
        const db = getTrustDbAdmin();
        await db.initialize();

        const dbData = db.getDatabase();
        if (!dbData) {
            // Database not initialized yet
            return;
        }

        // Safety Mode
        const currentTier = dbData.tranco.tier;
        const currentMode = TIER_TO_SAFETY_MODE[currentTier];

        if (dom?.safetyModeSelect) {
            dom.safetyModeSelect.value = currentMode;
        }
        if (dom?.trancoTierSelect) {
            dom.trancoTierSelect.value = currentTier;
        }

        // Tranco Status
        updateTrancoStatus({
            count: dbData.tranco.count,
            lastUpdated: dbData.tranco.lastUpdated || dbData.lastUpdated,
            tier: currentTier
        });

        // JP-Anchor List
        renderJpAnchorList(db.getJpAnchorTlds());

        // Sensitive List (default to finance)
        switchCategory('finance');

        // Whitelist
        renderWhitelistList(db.getWhitelist());

        // Alert Settings をTrustCheckerから読み込む
        const checker = getTrustChecker();
        const alertConfig = await checker.getAlertConfig();

        if (dom?.alertFinanceCheckbox) {
            dom.alertFinanceCheckbox.checked = alertConfig.alertFinance;
        }
        if (dom?.alertSensitiveCheckbox) {
            dom.alertSensitiveCheckbox.checked = alertConfig.alertSensitive;
        }
        if (dom?.alertUnverifiedCheckbox) {
            dom.alertUnverifiedCheckbox.checked = alertConfig.alertUnverified;
        }

        // P0: 「許可を検討するサイト」セッションを描画
        await renderPermissionSuggestList();
    }

    // ============================================================================
    // Initialization
    // ============================================================================

    function init(): void {
        resolveTrustDomElements();
        const {
            safetyModeSelect, trancoTierSelect, updateTrancoBtn,
            jpAnchorAddBtn, jpAnchorAddInput,
            sensitiveAddBtn, sensitiveAddInput, sensitiveCategorySelect,
            whitelistAddBtn, whitelistAddInput,
            saveTrustSettingsBtn, thresholdInput, categoryTabs,
        } = dom!;

        // Safety Mode change
        listen(safetyModeSelect, 'change', onSafetyModeChange);

        // Tranco Tier change
        listen(trancoTierSelect, 'change', onTrancoTierChange);

        // Tranco Update button
        listen(updateTrancoBtn, 'click', () => void updateTrancoList());

        // JP-Anchor Add button
        listen(jpAnchorAddBtn, 'click', () => {
            if (jpAnchorAddInput) {
                void addJpAnchorTld(jpAnchorAddInput.value.trim());
            }
        });

        // JP-Anchor Enter key
        if (jpAnchorAddInput) {
            listen(jpAnchorAddInput, 'keypress', ((e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    void addJpAnchorTld(jpAnchorAddInput.value.trim());
                }
            }) as EventListener);
        }

        // Category tabs
        categoryTabs?.forEach(tab => {
            listen(tab, 'click', () => {
                const category = tab.dataset.category as TrustCategory;
                if (category) {
                    switchCategory(category);
                }
            });
        });

        // Sensitive Domain Add button
        listen(sensitiveAddBtn, 'click', () => {
            if (sensitiveAddInput && sensitiveCategorySelect) {
                void addSensitiveDomain(sensitiveAddInput.value.trim(), sensitiveCategorySelect.value as TrustCategory);
            }
        });

        // Sensitive Domain Enter key
        if (sensitiveAddInput) {
            listen(sensitiveAddInput, 'keypress', ((e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (sensitiveCategorySelect) {
                        void addSensitiveDomain(sensitiveAddInput.value.trim(), sensitiveCategorySelect.value as TrustCategory);
                    }
                }
            }) as EventListener);
        }

        // Whitelist Add button
        listen(whitelistAddBtn, 'click', () => {
            if (whitelistAddInput) {
                void addWhitelistDomain(whitelistAddInput.value.trim());
            }
        });

        // Whitelist Enter key
        if (whitelistAddInput) {
            listen(whitelistAddInput, 'keypress', ((e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    void addWhitelistDomain(whitelistAddInput.value.trim());
                }
            }) as EventListener);
        }

        // Save Settings button
        listen(saveTrustSettingsBtn, 'click', () => void saveTrustSettings());

        logInfo('TrustSettings', {}, 'Trust settings module initialized');

        // P0: 許可検討セクションのイベントリスナー
        if (thresholdInput) {
            listen(thresholdInput, 'change', (async (e: Event) => {
                const newValue = parseInt((e.target as HTMLInputElement).value, 10);
                if (newValue >= 1 && newValue <= 50) {
                    // PBI 27-04: canonical writer is SettingsRepository (delta write
                    // into the nested settings blob). The old raw top-level single-key
                    // write is removed — it forked from the blob the migration owns.
                    await settingsRepository.set(StorageKeys.PERMISSION_NOTIFY_THRESHOLD, newValue);
                    await renderPermissionSuggestList(); // 再描画
                }
            }) as EventListener);
        }

        listen(document.getElementById('dismissAllPermissions'), 'click', (async () => {
            const { recordDomainDismissal } = await import('../../utils/permissionManager.js');
            const denied = await renderPermissionSuggestList();
            for (const { domain } of denied) {
                await recordDomainDismissal(domain);
            }
            await renderPermissionSuggestList(); // 再描画
        }) as EventListener);
    }

    // ============================================================================
    // P0: Permission Suggest Section（許可を検討するサイト）
    // ============================================================================

    /**
     * 許可を検討するサイトリストを描画
     * @returns 描画されたエントリの配列
     */
    async function renderPermissionSuggestList(): Promise<TrustPermissionSuggestEntry[]> {
        const thresholdInput = document.getElementById('permissionThreshold') as HTMLInputElement;
        const section = document.getElementById('permissionSuggestSection');
        const list = document.getElementById('permissionSuggestList');
        if (!section || !list) {
            return [];
        }

        const threshold = thresholdInput ? parseInt(thresholdInput.value, 10) : 3;
        const { getFrequentDeniedDomains, requestPermission, removeDeniedDomain, recordDomainDismissal, isHostPermitted } =
            await import('../../utils/permissionManager.js');

        const denied = await getFrequentDeniedDomains(threshold);
        if (denied.length > 0) {
            section.classList.remove('hidden');
        } else {
            section.classList.add('hidden');
        }
        list.textContent = '';

        const entries: TrustPermissionSuggestEntry[] = [];
        for (const { domain, count } of denied) {
            entries.push({ domain, count });

            const row = document.createElement('div');
            row.className = 'permission-suggest-row';

            const span = document.createElement('span');
            span.textContent = `${domain} — ${count}${getMessageOr('permissionSuggestCount', '回訪問')}`;

            const allowed = await isHostPermitted(`https://${domain}`);
            if (!allowed) {
                const allowBtn = document.createElement('button');
                allowBtn.className = 'btn-secondary btn-sm permission-suggest-allow';
                allowBtn.textContent = getMessageOr('permissionSuggestAdd', '🔓 許可する');
                allowBtn.addEventListener('click', async () => {
                    const granted = await requestPermission(`https://${domain}`);
                    if (granted) {
                        await removeDeniedDomain(domain);
                        await renderPermissionSuggestList(); // 再描画
                    }
                });

                const dismissBtn = document.createElement('button');
                dismissBtn.className = 'btn-icon permission-suggest-dismiss';
                dismissBtn.textContent = '×';
                dismissBtn.title = getMessageOr('permissionSuggestDismiss', '無視する（14日表示しない）');
                dismissBtn.addEventListener('click', async () => {
                    await recordDomainDismissal(domain);
                    await renderPermissionSuggestList(); // 再描画
                });

                row.appendChild(span);
                row.appendChild(allowBtn);
                row.appendChild(dismissBtn);
            } else {
                // 既に許可済みならdenied_domainsから削除
                await removeDeniedDomain(domain);
            }

            list.appendChild(row);
        }

        return entries;
    }

    function destroy(): void {
        for (const off of teardown.splice(0)) off();
        dom = null;
        currentCategory = 'finance';
    }

    return {
        init,
        loadTrustSettings,
        renderJpAnchorList,
        renderSensitiveList,
        renderPermissionSuggestList,
        destroy,
    };
}

// Safety Mode to Tranco Tier mapping
const SAFETY_MODE_TO_TIER: Record<SafetyMode, TrancoTier> = {
    strict: 'top1k',
    balanced: 'top10k',
    relaxed: 'top100k'
};

const TIER_TO_SAFETY_MODE: Record<TrancoTier, SafetyMode> = {
    top1k: 'strict',
    top10k: 'balanced',
    top100k: 'relaxed'
};

/**
 * The instance the module-level functions below delegate to. One per page is
 * the whole reason the panel is a singleton today; `createTrustSettings` exists
 * so a test (or a second mount) can hold an isolated one instead.
 */
const sharedController = createTrustSettings();

export function init(): void {
    sharedController.init();
}

export function loadTrustSettings(): Promise<void> {
    return sharedController.loadTrustSettings();
}

export function renderJpAnchorList(tlds: string[]): void {
    sharedController.renderJpAnchorList(tlds);
}

export function renderSensitiveList(domains: string[], isWhitelist = false): void {
    sharedController.renderSensitiveList(domains, isWhitelist);
}

export function renderPermissionSuggestList(): Promise<TrustPermissionSuggestEntry[]> {
    return sharedController.renderPermissionSuggestList();
}

export function destroyTrustSettings(): void {
    sharedController.destroy();
}
