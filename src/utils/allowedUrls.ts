/**
 * allowedUrls.ts
 * 許可URL管理機能
 */

import { normalizeUrl } from './urlUtils.js';
import type { Source } from './types.js';
import type { Settings } from './storageSettings.js';

/**
 * 設定から許可されたURLのリストを構築
 * @param {Record<string, unknown>} settings - 設定オブジェクト
 * @param {(url: string) => boolean} isDomainInWhitelistFunc - ドメインチェック関数
 * @returns {Set<string>} 許可されたURLのセット
 */
export function buildAllowedUrls(
    settings: Record<string, unknown>,
    isDomainInWhitelistFunc: (url: string) => boolean
): Set<string> {
    const allowedUrls = new Set<string>();

    // Obsidian API
    const protocol = (settings.obsidian_protocol as string) || 'https';
    const port = (settings.obsidian_port as string) || '27124';
    try {
        allowedUrls.add(normalizeUrl(`${protocol}://127.0.0.1:${port}`));
    } catch (e) {
        console.warn(`Invalid Obsidian URL (127.0.0.1), skipping: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
        allowedUrls.add(normalizeUrl(`${protocol}://localhost:${port}`));
    } catch (e) {
        console.warn(`Invalid Obsidian URL (localhost), skipping: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Gemini API
    allowedUrls.add('https://generativelanguage.googleapis.com');

    // OpenAI互換API - ホワイトリストチェック
    const openaiBaseUrl = settings.openai_base_url as string;
    if (openaiBaseUrl) {
        if (isDomainInWhitelistFunc(openaiBaseUrl)) {
            try {
                const normalized = normalizeUrl(openaiBaseUrl);
                allowedUrls.add(normalized);
            } catch (e) {
                console.warn(`Invalid OpenAI Base URL, skipping: ${openaiBaseUrl}, error: ${e instanceof Error ? e.message : String(e)}`);
            }
        } else {
            console.warn(`OpenAI Base URL not in whitelist, skipped: ${openaiBaseUrl}`);
        }
    }

    const openai2BaseUrl = settings.openai_2_base_url as string;
    if (openai2BaseUrl) {
        if (isDomainInWhitelistFunc(openai2BaseUrl)) {
            try {
                const normalized = normalizeUrl(openai2BaseUrl);
                allowedUrls.add(normalized);
            } catch (e) {
                console.warn(`Invalid OpenAI 2 Base URL, skipping: ${openai2BaseUrl}, error: ${e instanceof Error ? e.message : String(e)}`);
            }
        } else {
            console.warn(`OpenAI 2 Base URL not in whitelist, skipped: ${openai2BaseUrl}`);
        }
    }

    // uBlock Filter Sources - 既存のソース
    const ublockSources = (settings.ublock_sources as Source[]) || [];
    for (const source of ublockSources) {
        if (source.url && source.url !== 'manual') {
            try {
                const parsed = new URL(source.url);
                allowedUrls.add(normalizeUrl(parsed.origin));
            } catch (e) {
                // 無効なURLは無視
            }
        }
    }

    // uBlock Filter Sources - 固定的に許可するフィルターリスト提供サイト
    // 新規インポート時にもアクセスできるよう、固定ドメインを追加
    allowedUrls.add('https://raw.githubusercontent.com');
    allowedUrls.add('https://gitlab.com');
    allowedUrls.add('https://easylist.to');
    allowedUrls.add('https://pgl.yoyo.org');
    allowedUrls.add('https://nsfw.oisd.nl');

    return allowedUrls;
}

/**
 * URLリストのハッシュを計算
 * @param {Set<string>} urls - URLのセット
 * @returns {string} ハッシュ値
 */
export function computeUrlsHash(urls: Set<string>): string {
    const sortedUrls = Array.from(urls).sort();
    return sortedUrls.join('|');
}

/**
 * 設定を保存し、許可されたURLのリストを再構築
 * @param {Settings} settings - 設定オブジェクト
 * @param {(settings: Settings) => Promise<void>} saveSettingsFunc - saveSettings関数
 */
export async function saveSettingsWithAllowedUrls(
    settings: Settings,
    saveSettingsFunc: (settings: Settings) => Promise<void>
): Promise<void> {
    // 改訂: saveSettings を使用して常に暗号化とURLリスト更新を行う
    // Note: saveSettingsFuncは既にupdateAllowedUrlsFlag=trueで呼ばれる想定
    await saveSettingsFunc(settings);
}

/**
 * 許可されたURLのリストを取得
 * @param {string} ALLOWED_URLS_KEY - 許可URLのストレージキー
 * @returns {Promise<Set<string>>} 許可されたURLのセット
 */
export async function getAllowedUrls(ALLOWED_URLS_KEY: string): Promise<Set<string>> {
    const result = await chrome.storage.local.get(ALLOWED_URLS_KEY);
    const urls = (result[ALLOWED_URLS_KEY] as string[]) || [];
    return new Set(urls);
}