/**
 * aiDomainPolicySettings.ts
 * Per-domain AI egress policy editor (PBI 2026-10-23-01).
 *
 * Three policies per domain: allowed / no-summary / mask-required. The map is
 * persisted under AI_DOMAIN_POLICY; the send-time decision lives in
 * aiDomainPolicy.ts (single owner). This screen only edits the map.
 */

import { settingsRepository } from '../../utils/storage/SettingsRepository.js';
import { StorageKeys } from '../../utils/storage/types.js';
import type { AiDomainPolicy } from '../../utils/storage/types.js';
import { AI_DOMAIN_POLICIES, isAiDomainPolicy } from '../../utils/storage/types.js';
import { normalizeAiDomainPolicy, normalizeAiDomainPolicyMap } from '../../utils/storage/aiDomainPolicy.js';
import { errorMessage } from '../../utils/errorUtils.js';
import { isValidDomainPattern } from '../../utils/domainValidator.js';
import { showStatus } from '../../utils/ui/settingsUiHelper.js';
import { clearElement } from '../../utils/domClear.js';
import { getMessage, getMessageOr } from '../../utils/i18n.js';

interface AiDomainPolicyDom {
    addBtn: HTMLElement | null;
    input: HTMLInputElement | null;
    select: HTMLSelectElement | null;
    list: HTMLElement | null;
    error: HTMLElement | null;
    status: HTMLElement | null;
}

export interface AiDomainPolicyController {
    /** Wire the add button. Re-resolves the DOM first. */
    init(): void;
    /** Re-read the persisted policy map into the panel. */
    loadAiDomainPolicies(): Promise<void>;
    /** Detach every listener and drop every element reference. */
    destroy(): void;
}

export function createAiDomainPolicySettings(): AiDomainPolicyController {
    let dom: AiDomainPolicyDom | null = null;
    const teardown: Array<() => void> = [];

    function resolveDom(): void {
        dom = {
            addBtn: document.getElementById('aiDomainPolicyAddBtn'),
            input: document.getElementById('aiDomainPolicyInput') as HTMLInputElement | null,
            select: document.getElementById('aiDomainPolicySelect') as HTMLSelectElement | null,
            list: document.getElementById('aiDomainPolicyList'),
            error: document.getElementById('aiDomainPolicyError'),
            status: document.getElementById('aiDomainPolicyStatus'),
        };
    }

    function ensureDom(): void {
        if (!dom) resolveDom();
    }

    function listen(target: EventTarget | null | undefined, type: string, handler: EventListenerOrEventListenerObject): void {
        if (!target) return;
        target.addEventListener(type, handler);
        teardown.push(() => target.removeEventListener(type, handler));
    }

    /** Populate the policy select from the AI_DOMAIN_POLICIES set (SSOT). */
    function fillPolicySelect(): void {
        ensureDom();
        if (!dom?.select) return;
        clearElement(dom.select);
        for (const policy of AI_DOMAIN_POLICIES) {
            const option = document.createElement('option');
            option.value = policy;
            option.textContent = getMessageOr(`aiDomainPolicy_${policy}`, policy);
            dom.select.appendChild(option);
        }
    }

    function renderRow(domain: string, policy: AiDomainPolicy): HTMLElement {
        const row = document.createElement('div');
        row.className = 'ai-domain-policy-row';
        row.setAttribute('role', 'listitem');
        row.dataset.domain = domain;
        const label = document.createElement('span');
        label.className = 'ai-domain-policy-domain';
        label.textContent = domain;
        const badge = document.createElement('span');
        badge.className = 'ai-domain-policy-badge';
        badge.textContent = getMessageOr(`aiDomainPolicy_${policy}`, policy);
        const removeBtn = document.createElement('button');
        removeBtn.className = 'secondary-btn ai-domain-policy-remove';
        removeBtn.setAttribute('aria-label', getMessageOr('aiDomainPolicyRemoveAria', 'Remove', [domain]));
        removeBtn.textContent = getMessage('aiDomainPolicyRemove');
        removeBtn.addEventListener('click', () => {
            void removePolicy(domain);
        });
        row.append(label, badge, removeBtn);
        return row;
    }

    function renderList(map: Record<string, AiDomainPolicy>): void {
        ensureDom();
        if (!dom?.list) return;
        clearElement(dom.list);
        const domains = Object.keys(map).sort();
        if (domains.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'help-text';
            empty.textContent = getMessageOr('aiDomainPolicyEmpty', 'No per-domain policies set.');
            dom.list.appendChild(empty);
            return;
        }
        for (const domain of domains) {
            // noUncheckedIndexedAccess: the row's own key read fails closed to
            // the default policy, so a sparse row cannot render an undefined.
            dom.list.appendChild(renderRow(domain, normalizeAiDomainPolicy(map[domain])));
        }
    }

    async function persist(map: Record<string, AiDomainPolicy>): Promise<void> {
        await settingsRepository.setAll({ [StorageKeys.AI_DOMAIN_POLICY]: map });
    }

    async function addPolicy(): Promise<void> {
        ensureDom();
        if (!dom?.input || !dom.select || !dom.error) return;
        const domain = dom.input.value.trim();
        dom.error.textContent = '';
        if (!domain) return;
        if (!isValidDomainPattern(domain)) {
            dom.error.textContent = getMessageOr('aiDomainPolicyInvalidDomain', 'Enter a valid domain, e.g. example.com');
            return;
        }
        const policyValue = dom.select.value;
        const policy: AiDomainPolicy = isAiDomainPolicy(policyValue) ? policyValue : 'allowed';
        try {
            const map = normalizeAiDomainPolicyMap((await settingsRepository.getAll())[StorageKeys.AI_DOMAIN_POLICY]);
            map[domain] = policy;
            await persist(map);
            dom.input.value = '';
            renderList(map);
            showStatus(dom.status, getMessageOr('aiDomainPolicySaved', 'Saved'), 'success');
        } catch (error) {
            dom.error.textContent = errorMessage(error);
        }
    }

    async function removePolicy(domain: string): Promise<void> {
        ensureDom();
        if (!dom?.error) return;
        dom.error.textContent = '';
        try {
            const map = normalizeAiDomainPolicyMap((await settingsRepository.getAll())[StorageKeys.AI_DOMAIN_POLICY]);
            delete map[domain];
            await persist(map);
            renderList(map);
        } catch (error) {
            dom.error.textContent = errorMessage(error);
        }
    }

    function init(): void {
        destroy();
        resolveDom();
        fillPolicySelect();
        listen(dom?.addBtn, 'click', () => {
            void addPolicy();
        });
    }

    async function loadAiDomainPolicies(): Promise<void> {
        ensureDom();
        fillPolicySelect();
        try {
            const settings = await settingsRepository.getAll();
            renderList(normalizeAiDomainPolicyMap(settings[StorageKeys.AI_DOMAIN_POLICY]));
        } catch (error) {
            ensureDom();
            if (dom?.error) dom.error.textContent = errorMessage(error);
        }
    }

    function destroy(): void {
        for (const remove of teardown) remove();
        teardown.length = 0;
        dom = null;
    }

    return { init, loadAiDomainPolicies, destroy };
}

/** Keep the shared editor instance lazy so importing the module stays side-effect free. */
let sharedController: AiDomainPolicyController | null = null;

export function getAiDomainPolicySettings(): AiDomainPolicyController {
    if (!sharedController) sharedController = createAiDomainPolicySettings();
    return sharedController;
}

export function initAiDomainPolicySettings(): void {
    getAiDomainPolicySettings().init();
}

export async function loadAiDomainPolicySettings(): Promise<void> {
    await getAiDomainPolicySettings().loadAiDomainPolicies();
}
