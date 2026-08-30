/**
 * storage/urlWhitelist.ts
 * URL whitelist and allowed-URL construction derived from settings.
 * Extracted from settingsStore.ts (PBI-01).
 */

import { normalizeUrl } from '../urlUtils.js';
import { errorMessage } from '../errorUtils.js';
import { StorageKeys } from './types.js';
import type { Settings } from './types.js';

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
    const openaiBaseUrl = settings[StorageKeys.OPENAI_BASE_URL] as string | undefined;
    if (openaiBaseUrl) {
        if (isDomainInWhitelist(openaiBaseUrl)) {
            try {
                const normalized = normalizeUrl(openaiBaseUrl);
                allowedUrls.add(normalized);
            } catch (e) {
                console.warn(`Invalid OpenAI Base URL, skipping: ${openaiBaseUrl}, error: ${errorMessage(e)}`);
            }
        } else {
            console.warn(`OpenAI Base URL not in whitelist, skipped: ${openaiBaseUrl}`);
        }
    }
    const openai2BaseUrl = settings[StorageKeys.OPENAI_2_BASE_URL] as string | undefined;
    if (openai2BaseUrl) {
        if (isDomainInWhitelist(openai2BaseUrl)) {
            try {
                const normalized = normalizeUrl(openai2BaseUrl);
                allowedUrls.add(normalized);
            } catch (e) {
                console.warn(`Invalid OpenAI 2 Base URL, skipping: ${openai2BaseUrl}, error: ${errorMessage(e)}`);
            }
        } else {
            console.warn(`OpenAI 2 Base URL not in whitelist, skipped: ${openai2BaseUrl}`);
        }
    }
    const providerBaseUrl = settings[StorageKeys.PROVIDER_BASE_URL] as string | undefined;
    if (providerBaseUrl) {
        if (isDomainInWhitelist(providerBaseUrl)) {
            try {
                const normalized = normalizeUrl(providerBaseUrl);
                allowedUrls.add(normalized);
            } catch (e) {
                console.warn(`Invalid Provider Base URL, skipping: ${providerBaseUrl}, error: ${errorMessage(e)}`);
            }
        } else {
            console.warn(`Provider Base URL not in whitelist, skipped: ${providerBaseUrl}`);
        }
    }
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
