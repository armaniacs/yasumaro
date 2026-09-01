/**
 * storage/urlWhitelist.ts
 * URL whitelist and allowed-URL construction derived from settings.
 * Extracted from settingsStore.ts (PBI-01).
 */

import { normalizeUrl } from '../urlUtils.js';
import { errorMessage } from '../errorUtils.js';
import { StorageKeys } from './types.js';
import type { Settings } from './types.js';
import { PROVIDER_CATALOG } from '../../background/ai/providerCatalog.js';

/**
 * Add each configured remote-provider Base URL to `allowedUrls`, gated on the
 * whitelist. Derived from PROVIDER_CATALOG so a new provider's base URL is
 * covered by its registry row alone (was 3× copy-pasted per file).
 * Local providers (lm-studio/ollama) are skipped — their localhost origins are
 * covered by the Obsidian localhost block that always runs before this.
 */
export function addProviderBaseUrls(
    allowedUrls: Set<string>,
    settings: Record<string, unknown>,
    isInWhitelist: (url: string) => boolean,
): void {
    for (const entry of PROVIDER_CATALOG.values()) {
        if (!entry.baseUrlKey || entry.isLocal) continue;
        const rawUrl = settings[entry.baseUrlKey] as string | undefined;
        if (!rawUrl) continue;
        if (isInWhitelist(rawUrl)) {
            try {
                allowedUrls.add(normalizeUrl(rawUrl));
            } catch (e) {
                console.warn(`Invalid ${entry.label} Base URL, skipping: ${rawUrl}, error: ${errorMessage(e)}`);
            }
        } else {
            console.warn(`${entry.label} Base URL not in whitelist, skipped: ${rawUrl}`);
        }
    }
}

export const ALLOWED_AI_PROVIDER_DOMAINS = [
    'generativelanguage.googleapis.com',
    'api.groq.com',
    'api.openai.com',
    'api.anthropic.com',
    'api-inference.huggingface.co',
    'openrouter.ai',
    'api.openrouter.ai',
    'mistral.ai',
    'deepinfra.com',
    'cerebras.ai',
    'ai-gateway.helicone.ai',
    'api.publicai.co',
    'api.venice.ai',
    'api.scaleway.ai',
    'api.synthetic.new',
    'api.stima.tech',
    'nano-gpt.com',
    'api.poe.com',
    'llm.chutes.ai',
    'api.abliteration.ai',
    'api.llamagate.dev',
    'api.gmi-serving.com',
    'api.sarvam.ai',
    'deepseek.com',
    'xiaomimimo.com',
    'nebius.com',
    'sambanova.ai',
    'nscale.com',
    'featherless.ai',
    'galadriel.com',
    'perplexity.ai',
    'recraft.ai',
    'jina.ai',
    'voyageai.com',
    'volcengine.com',
    'z.ai',
    'wandb.ai',
    'api.ai.sakura.ad.jp',
    'raw.githubusercontent.com',
    'gitlab.com',
    'easylist.to',
    'pgl.yoyo.org',
    'localhost',
    '127.0.0.1',
];

export function isDomainInWhitelist(url: string): boolean {
    try {
        const parsedUrl = new URL(url);
        const hostname = parsedUrl.hostname;
        if (ALLOWED_AI_PROVIDER_DOMAINS.includes(hostname)) {
            return true;
        }
        for (const allowedDomain of ALLOWED_AI_PROVIDER_DOMAINS) {
            if (allowedDomain.startsWith('*.')) {
                const domainSuffix = allowedDomain.substring(2);
                if (hostname === domainSuffix || hostname.endsWith('.' + domainSuffix)) {
                    return true;
                }
            }
        }
        return false;
    } catch (_e) {
        return false;
    }
}

export function buildAllowedUrls(settings: Settings): Set<string> {
    const allowedUrls = new Set<string>();
    const protocol = (settings[StorageKeys.OBSIDIAN_PROTOCOL] as string) || 'https';
    const port = (settings[StorageKeys.OBSIDIAN_PORT] as string) || '27124';
    try {
        allowedUrls.add(normalizeUrl(`${protocol}://127.0.0.1:${port}`));
    } catch (e) {
        console.warn(`Invalid Obsidian URL (127.0.0.1), skipping: ${errorMessage(e)}`);
    }
    try {
        allowedUrls.add(normalizeUrl(`${protocol}://localhost:${port}`));
    } catch (e) {
        console.warn(`Invalid Obsidian URL (localhost), skipping: ${errorMessage(e)}`);
    }
    allowedUrls.add('https://generativelanguage.googleapis.com');
    addProviderBaseUrls(allowedUrls, settings as Record<string, unknown>, isDomainInWhitelist);
    const ublockSources = (settings[StorageKeys.UBLOCK_SOURCES] as Array<{ url?: string }>) || [];
    for (const source of ublockSources) {
        if (source.url && source.url !== 'manual') {
            try {
                const parsed = new URL(source.url);
                // Gate on the whitelist: a stored ublock source must not be able
                // to add an arbitrary origin to the allow list on its own.
                if (isDomainInWhitelist(source.url)) {
                    allowedUrls.add(normalizeUrl(parsed.origin));
                } else {
                    console.warn(`uBlock source origin not in whitelist, skipped: ${parsed.origin}`);
                }
            } catch (_e) {
                // ignore invalid URL
            }
        }
    }
    allowedUrls.add('https://raw.githubusercontent.com');
    allowedUrls.add('https://gitlab.com');
    allowedUrls.add('https://easylist.to');
    allowedUrls.add('https://pgl.yoyo.org');
    allowedUrls.add('https://nsfw.oisd.nl');
    return allowedUrls;
}

export function computeUrlsHash(urls: Set<string>): string {
    const sortedUrls = Array.from(urls).sort();
    return sortedUrls.join('|');
}

export async function getAllowedUrls(): Promise<Set<string>> {
    const result = await chrome.storage.local.get(StorageKeys.ALLOWED_URLS);
    const urls = (result[StorageKeys.ALLOWED_URLS] as string[]) || [];
    return new Set(urls);
}
