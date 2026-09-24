/**
 * perSiteOverrides.ts
 * Dashboard UI for domain_cleansing_overrides — minimal panel inside AI Summary Cleansing.
 */

import { settingsRepository } from '../../utils/storage/SettingsRepository.js';
import { readOverrides } from './presetSettingsAdapter.js';
import { getMessageOr } from '../../utils/i18n.js';
import { StorageKeys, type DomainCleansingOverride } from '../../utils/storage/types.js';
import { CLEANSING_RULES } from '../../utils/aiSummaryCleaner/rules.js';
import { normalizeDomain, upsertDomainOverride } from '../../utils/aiSummaryCleaner/perSiteOverride.js';
import { logError } from '../../utils/logger/api.js';
import { ErrorCode } from '../../utils/logger/types.js';
import { errorMessage } from '../../utils/errorUtils.js';

function ruleCheckboxId(key: string): string {
    return `per-site-override-${key}`;
}

function buildToggles(container: HTMLElement): void {
    container.innerHTML = '';
    for (const rule of CLEANSING_RULES) {
        const id = ruleCheckboxId(rule.key);
        const wrap = document.createElement('div');
        wrap.className = 'mb-4';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = id;
        cb.dataset.ruleKey = rule.key;
        const label = document.createElement('label');
        label.htmlFor = id;
        label.className = 'inline-label';
        label.textContent = `${rule.key} (${rule.storageKey})`;
        wrap.appendChild(cb);
        wrap.appendChild(label);
        container.appendChild(wrap);
    }
}

function readToggles(container: HTMLElement): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    for (const rule of CLEANSING_RULES) {
        const cb = document.getElementById(ruleCheckboxId(rule.key)) as HTMLInputElement | null;
        if (cb && container.contains(cb)) out[`${rule.key}Enabled`] = cb.checked;
    }
    return out;
}

function applyToggles(container: HTMLElement, overrides: Record<string, unknown>): void {
    for (const rule of CLEANSING_RULES) {
        const cb = document.getElementById(ruleCheckboxId(rule.key)) as HTMLInputElement | null;
        if (!cb || !container.contains(cb)) continue;
        const key = `${rule.key}Enabled`;
        if (key in overrides) cb.checked = Boolean(overrides[key]);
        else cb.checked = false;
        cb.indeterminate = false;
    }
}

function clearToggles(container: HTMLElement): void {
    for (const rule of CLEANSING_RULES) {
        const cb = document.getElementById(ruleCheckboxId(rule.key)) as HTMLInputElement | null;
        if (cb && container.contains(cb)) { cb.checked = false; }
    }
}

async function loadOverrides(): Promise<DomainCleansingOverride[]> {
    // Targeted read (PBI 2026-09-23-15): the single-key API instead of a
    // full getAll() on every toggle/change/refresh.
    return readOverrides();
}

async function saveOverrides(next: DomainCleansingOverride[]): Promise<void> {
    // Delta write (PBI 2026-09-17-17) — a fresh full read here would carry
    // its staleness window into every other stored key.
    await settingsRepository.setAll({
        [StorageKeys.DOMAIN_CLEANSING_OVERRIDES]: next,
    });
}

function renderList(listEl: HTMLElement, overrides: DomainCleansingOverride[], onSelect: (d: string) => void): void {
    listEl.innerHTML = '';
    if (overrides.length === 0) {
        listEl.textContent = getMessageOr('noPerSiteOverrides', 'No per-site overrides.');
        return;
    }
    const ul = document.createElement('ul');
    for (const entry of overrides) {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.className = 'link-btn';
        btn.textContent = entry.domain;
        btn.addEventListener('click', () => onSelect(entry.domain));
        li.appendChild(btn);
        const span = document.createElement('span');
        const keys = Object.keys(entry.overrides).join(', ') || '(empty)';
        span.textContent = ` — ${keys}`;
        span.className = 'per-site-override-suffix';
        li.appendChild(span);
        ul.appendChild(li);
    }
    listEl.appendChild(ul);
}

export function initPerSiteOverrides(): void {
    const domainInput = document.getElementById('perSiteOverrideDomain') as HTMLInputElement | null;
    const togglesContainer = document.getElementById('perSiteOverrideToggles') as HTMLElement | null;
    const saveBtn = document.getElementById('perSiteOverrideSaveBtn') as HTMLButtonElement | null;
    const deleteBtn = document.getElementById('perSiteOverrideDeleteBtn') as HTMLButtonElement | null;
    const statusEl = document.getElementById('perSiteOverrideStatus') as HTMLElement | null;
    const listEl = document.getElementById('perSiteOverrideList') as HTMLElement | null;

    if (!domainInput || !togglesContainer || !saveBtn || !deleteBtn || !listEl) return;

    buildToggles(togglesContainer);

    const setStatus = (msg: string, isError = false) => {
        if (!statusEl) return;
        statusEl.textContent = msg;
        statusEl.className = isError ? 'status-message error' : 'status-message success';
        if (isError) return; // errors must not vanish: auto-clear hides the failure (Checking Team 2026-09-22, UI Medium)
        if (msg) setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'status-message'; }, 3000);
    };

    const refresh = async (selectDomain?: string) => {
        const overrides = await loadOverrides();
        renderList(listEl, overrides, (d) => {
            domainInput.value = d;
            const found = overrides.find((o) => normalizeDomain(o.domain) === normalizeDomain(d));
            if (found) applyToggles(togglesContainer, found.overrides as Record<string, unknown>);
        });
        if (selectDomain) {
            const found = overrides.find((o) => normalizeDomain(o.domain) === normalizeDomain(selectDomain));
            if (found) applyToggles(togglesContainer, found.overrides as Record<string, unknown>);
            else clearToggles(togglesContainer);
        }
    };

    void refresh();

    domainInput.addEventListener('change', async () => {
        const d = normalizeDomain(domainInput.value);
        if (!d) { clearToggles(togglesContainer); return; }
        const overrides = await loadOverrides();
        const found = overrides.find((o) => normalizeDomain(o.domain) === d);
        if (found) applyToggles(togglesContainer, found.overrides as Record<string, unknown>);
        else clearToggles(togglesContainer);
    });

    saveBtn.addEventListener('click', async () => {
        const rawDomain = domainInput.value;
        const domain = normalizeDomain(rawDomain);
        if (!domain) { setStatus('Domain is required', true); return; }
        // very light validation — reject empty / spaces / protocol
        if (domain.includes('/') || domain.includes(':') || domain.includes(' ')) {
            setStatus('Invalid domain', true); return;
        }
        const patch = readToggles(togglesContainer);
        // Store the full checked map so a domain can force a rule OFF as well
        // as ON (unchecked = no override for that rule).
        const overrides = await loadOverrides();
        const next = upsertDomainOverride(overrides, domain, patch);
        // Single writer: the repository delta write lands inside the 'settings'
        // object under lock, which is exactly where contentKernel reads it from —
        // no out-of-lock raw top-level write is needed for immediate reads.
        try {
            await saveOverrides(next);
        } catch (error) {
            setStatus(getMessageOr('settingsSaveError', 'Failed to save override'), true);
            await logError('Failed to save per-site override', { cause: errorMessage(error), domain }, ErrorCode.STORAGE_WRITE_FAILURE, 'perSiteOverrides');
            return;
        }
        await refresh(domain);
        setStatus('Saved');
    });

    deleteBtn.addEventListener('click', async () => {
        const domain = normalizeDomain(domainInput.value);
        if (!domain) { setStatus('Domain is required', true); return; }
        const overrides = await loadOverrides();
        const next = upsertDomainOverride(overrides, domain, null);
        if (next.length === overrides.length) { setStatus('No override for domain', true); return; }
        try {
            await saveOverrides(next);
        } catch (error) {
            setStatus(getMessageOr('settingsSaveError', 'Failed to delete override'), true);
            await logError('Failed to delete per-site override', { cause: errorMessage(error), domain }, ErrorCode.STORAGE_WRITE_FAILURE, 'perSiteOverrides');
            return;
        }
        clearToggles(togglesContainer);
        await refresh();
        setStatus('Deleted');
    });
}
