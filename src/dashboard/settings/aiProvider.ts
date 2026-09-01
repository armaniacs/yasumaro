/**
 * AIプロバイダー UI 表示制御モジュール
 * AIプロバイダーの選択に応じて、各プロバイダー設定パネルの表示/非表示を切り替える。
 * 対象 provider・権限 URL は ProviderCatalog から導出する（ハードコードの
 * if 連鎖・URL マップを廃止）。
 */

import { PermissionManager } from '../../utils/permissionManager.js';
import { errorMessage } from '../../utils/errorUtils.js';
import { logWarn } from '../../utils/logger.js';
import { PROVIDER_CATALOG } from '../../background/ai/providerCatalog.js';
import { providerIdsInOrder } from '../aiProviderCatalogView.js';
import type { ProviderId } from '../../utils/storage/types.js';

/** Per-provider settings elements, keyed by provider id. */
export interface AIProviderElements {
    select: HTMLSelectElement;
    settings: Record<string, HTMLElement | undefined>;
}

/**
 * Collects the provider settings elements from the options page. Both layouts
 * name each block `#<providerId>Settings`.
 */
export function getAiProviderElements(): AIProviderElements {
    const settings: Record<string, HTMLElement | undefined> = {};
    for (const id of providerIdsInOrder()) {
        settings[id] = (document.getElementById(`${id}Settings`) as HTMLElement) ?? undefined;
    }
    return {
        select: document.getElementById('aiProvider') as HTMLSelectElement,
        settings,
    };
}

/**
 * The host origin to request permission for when a provider is selected.
 * undefined = no network permission needed (built-in-ai) or user-configured
 * (openai-compatible).
 */
function providerPermissionUrl(id: string): string | undefined {
    const entry = PROVIDER_CATALOG.get(id as ProviderId);
    if (!entry) return undefined;
    if (entry.settingsBlockKind === 'built-in-ai') return undefined;
    if (entry.settingsBlockKind === 'models-dev') return undefined; // user enters their own URL
    if (entry.cspDomain) return `${entry.cspDomain}/`;
    if (entry.defaultBaseUrl) {
        try {
            return `${new URL(entry.defaultBaseUrl).origin}/`;
        } catch {
            return undefined;
        }
    }
    return undefined;
}

/** Show only the selected provider's settings block. */
export function updateAIProviderVisibility(elements: AIProviderElements): void {
    const active = elements.select.value;
    for (const id of providerIdsInOrder()) {
        const el = elements.settings[id];
        if (el) el.style.display = id === active ? 'block' : 'none';
    }
}

/** Show every selected provider's settings block (priority list 1-3). */
export function updateAIProviderVisibilityMulti(elements: AIProviderElements, selectedProviders: string[]): void {
    const selected = new Set(selectedProviders.filter((p) => p !== ''));
    for (const id of providerIdsInOrder()) {
        const el = elements.settings[id];
        if (el) el.style.display = selected.has(id) ? 'block' : 'none';
    }
}

async function requestAIProviderPermission(provider: string): Promise<boolean> {
    const url = providerPermissionUrl(provider);
    if (!url) return true;

    const permManager = new PermissionManager();
    if (await permManager.isHostPermitted(url)) return true;

    const granted = await permManager.requestPermission(url);
    if (!granted) {
        logWarn('AIProvider', { provider, url }, undefined, 'AI provider permission denied by user');
    }
    return granted;
}

export function setupAIProviderChangeListener(elements: AIProviderElements): void {
    elements.select.addEventListener('change', () => {
        updateAIProviderVisibility(elements);
        const provider = elements.select.value;
        if (provider !== 'openai-compatible') {
            requestAIProviderPermission(provider).catch((error) => {
                logWarn('AIProvider', { error: errorMessage(error), provider }, undefined, 'Failed to request AI provider permission');
            });
        }
    });
}
