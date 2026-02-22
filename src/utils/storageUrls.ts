/**
 * storageUrls.ts
 * URL管理関連の機能
 * 保存URLの管理、LRU追跡、許可URLリストの構築
 */

import { withOptimisticLock, ensureVersionInitialized } from './optimisticLock.js';
import { normalizeUrl } from './urlUtils.js';
import type { Source } from './types.js';

// URL set size limit constants
export const MAX_URL_SET_SIZE = 10000;
export const URL_WARNING_THRESHOLD = 8000;
export const URL_RETENTION_DAYS = 7;

/**
 * 記録方式
 * - auto: 自動記録（訪問条件を満たして自動的に記録）
 * - manual: 手動記録（「今すぐ記録」ボタンで記録）
 */
export type RecordType = 'auto' | 'manual';

/**
 * 保存されたURLエントリ
 */
export interface SavedUrlEntry {
    url: string;
    timestamp: number;
    recordType?: RecordType;
    maskedCount?: number;
}

/**
 * 保存されたURLのリストを取得（LRU削除有効）
 * @returns {Promise<Set<string>>} 保存されたURLのセット
 */
export async function getSavedUrls(): Promise<Set<string>> {
    const result = await chrome.storage.local.get('savedUrls');
    return new Set((result.savedUrls as string[]) || []);
}

/**
 * タイムスタンプ付きの詳細なURLエントリを取得
 * @returns {Promise<Map<string, number>>} URLからタイムスタンプへのマップ
 */
export async function getSavedUrlsWithTimestamps(): Promise<Map<string, number>> {
    const result = await chrome.storage.local.get('savedUrlsWithTimestamps');
    const entries = (result.savedUrlsWithTimestamps as SavedUrlEntry[]) || [];
    const urlMap = new Map<string, number>();
    for (const entry of entries) {
        urlMap.set(entry.url, entry.timestamp);
    }
    return urlMap;
}

/**
 * 記録方式を含む詳細なURLエントリをすべて取得
 * @returns {Promise<SavedUrlEntry[]>} 保存されたURLエントリの配列
 */
export async function getSavedUrlEntries(): Promise<SavedUrlEntry[]> {
    const result = await chrome.storage.local.get('savedUrlsWithTimestamps');
    return (result.savedUrlsWithTimestamps as SavedUrlEntry[]) || [];
}

/**
 * URLのリストを保存（LRU削除有効）
 * @param {Set<string>} urlSet - 保存するURLのセット
 * @param {string} [urlToAdd] - 追加/更新するURL（現在のタイムスタンプ付き）（オプション）
 */
export async function setSavedUrls(urlSet: Set<string>, urlToAdd: string | null = null): Promise<void> {
    const urlArray = Array.from(urlSet);

    // 楽観的ロックで安全に保存
    await withOptimisticLock('savedUrls', () => urlArray, { maxRetries: 5 });

    // LRUタイムスタンプを管理
    if (urlToAdd) {
        await updateUrlTimestamp(urlToAdd);
    }
}

/**
 * タイムスタンプ付きのURL Mapを保存（日付ベース重複チェック用）
 * @param {Map<string, number>} urlMap - URLからタイムスタンプへのマップ
 * @param {string} [urlToAdd] - 追加/更新するURL（現在のタイムスタンプ付き）（オプション）
 */
export async function setSavedUrlsWithTimestamps(urlMap: Map<string, number>, urlToAdd: string | null = null): Promise<void> {
    // Mapからエントリ配列に変換
    const entries = Array.from(urlMap.entries()).map(([url, timestamp]) => ({ url, timestamp }));
    const urlArray = Array.from(urlMap.keys());

    // savedUrlsWithTimestampsの楽観的ロックを使用
    await withOptimisticLock('savedUrlsWithTimestamps', () => entries, { maxRetries: 5 });

    // savedUrlsがsavedUrlsWithTimestampsと同期されていない場合は個別に更新
    // (互換性維持のため、savedUrlsも保存する)
    // Note: これは競合の可能性がありますが、savedUrlsはsavedUrlsWithTimestampsから再生成可能です
    const currentSavedUrls = await chrome.storage.local.get('savedUrls');
    const currentSavedArray = currentSavedUrls['savedUrls'] as string[] || [];

    // 配列が同じならスキップ
    if (JSON.stringify(currentSavedArray.sort()) !== JSON.stringify(urlArray.sort())) {
        await chrome.storage.local.set({ savedUrls: urlArray });
    }
}

/**
 * LRU追跡のためのURLタイムスタンプを更新
 * @param {string} url - 更新するURL
 * @param {RecordType} [recordType] - 記録方式
 */
async function updateUrlTimestamp(url: string, recordType?: RecordType): Promise<void> {
    const result = await chrome.storage.local.get('savedUrlsWithTimestamps');
    let entries = (result.savedUrlsWithTimestamps as SavedUrlEntry[]) || [];

    // 既存のURLがある場合は削除
    entries = entries.filter(entry => entry.url !== url);

    // 新しいエントリを追加
    const entry: SavedUrlEntry = { url, timestamp: Date.now() };
    if (recordType) entry.recordType = recordType;
    entries.push(entry);

    // 7日より古いエントリを削除（日数ベース）
    const cutoff = Date.now() - URL_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    entries = entries.filter(entry => entry.timestamp >= cutoff);

    // それでもMAX_URL_SET_SIZEを超える場合は古い順にLRU削除
    if (entries.length > MAX_URL_SET_SIZE) {
        entries.sort((a, b) => a.timestamp - b.timestamp);
        entries = entries.slice(entries.length - MAX_URL_SET_SIZE);
    }

    await chrome.storage.local.set({ savedUrlsWithTimestamps: entries });
}

/**
 * URLを保存リストに追加（LRU追跡付き、日付ベース対応）
 * @param {string} url - 追加するURL
 * @param {RecordType} [recordType] - 記録方式
 */
export async function addSavedUrl(url: string, recordType?: RecordType): Promise<void> {
    const urlMap = await getSavedUrlsWithTimestamps();
    urlMap.set(url, Date.now());
    await setSavedUrlsWithTimestamps(urlMap, url);
    await updateUrlTimestamp(url, recordType);
}

/**
 * 記録済みURLのrecordTypeを更新する
 * @param {string} url - 更新するURL
 * @param {RecordType} recordType - 記録方式
 */
export async function setUrlRecordType(url: string, recordType: RecordType): Promise<void> {
    const result = await chrome.storage.local.get('savedUrlsWithTimestamps');
    const entries = (result.savedUrlsWithTimestamps as SavedUrlEntry[]) || [];
    const idx = entries.findIndex(e => e.url === url);
    if (idx >= 0) {
        entries[idx] = { ...entries[idx], recordType };
        await chrome.storage.local.set({ savedUrlsWithTimestamps: entries });
    }
}

/**
 * 記録済みURLのmaskedCountを更新する
 * @param {string} url - 更新するURL
 * @param {number} maskedCount - マスクしたPII件数
 */
export async function setUrlMaskedCount(url: string, maskedCount: number): Promise<void> {
    const result = await chrome.storage.local.get('savedUrlsWithTimestamps');
    const entries = (result.savedUrlsWithTimestamps as SavedUrlEntry[]) || [];
    const idx = entries.findIndex(e => e.url === url);
    if (idx >= 0) {
        entries[idx] = { ...entries[idx], maskedCount };
        await chrome.storage.local.set({ savedUrlsWithTimestamps: entries });
    }
}

/**
 * URLを保存リストから削除
 * @param {string} url - 削除するURL
 */
export async function removeSavedUrl(url: string): Promise<void> {
    // 楽観的ロックで安全に削除
    await withOptimisticLock('savedUrls', (currentUrls: string[]) => {
        const urlSet = new Set(currentUrls || []);
        urlSet.delete(url);
        return Array.from(urlSet);
    }, { maxRetries: 5 });

    // タイムスタンプ管理からも削除
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        return entries.filter(entry => entry.url !== url);
    }, { maxRetries: 5 });
}

/**
 * URLが保存リストに含まれているかチェック
 * @param {string} url - チェックするURL
 * @returns {Promise<boolean>} URLが保存されている場合はtrue
 */
export async function isUrlSaved(url: string): Promise<boolean> {
    const currentUrls = await getSavedUrls();
    return currentUrls.has(url);
}

/**
 * 保存されたURLの件数を取得
 * @returns {Promise<number>} 保存されたURLの件数
 */
export async function getSavedUrlCount(): Promise<number> {
    const currentUrls = await getSavedUrls();
    return currentUrls.size;
}

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
    const protocol = (settings.obsidian_protocol as string) || 'http';
    const port = (settings.obsidian_port as string) || '27123';
    allowedUrls.add(normalizeUrl(`${protocol}://127.0.0.1:${port}`));
    allowedUrls.add(normalizeUrl(`${protocol}://localhost:${port}`));

    // Gemini API
    allowedUrls.add('https://generativelanguage.googleapis.com');

    // OpenAI互換API - ホワイトリストチェック
    const openaiBaseUrl = settings.openai_base_url as string;
    if (openaiBaseUrl) {
        if (isDomainInWhitelistFunc(openaiBaseUrl)) {
            const normalized = normalizeUrl(openaiBaseUrl);
            allowedUrls.add(normalized);
        } else {
            console.warn(`OpenAI Base URL not in whitelist, skipped: ${openaiBaseUrl}`);
        }
    }

    const openai2BaseUrl = settings.openai_2_base_url as string;
    if (openai2BaseUrl) {
        if (isDomainInWhitelistFunc(openai2BaseUrl)) {
            const normalized = normalizeUrl(openai2BaseUrl);
            allowedUrls.add(normalized);
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
 * @param {import('./storageSettings.js').Settings} settings - 設定オブジェクト
 * @param {(settings: import('./storageSettings.js').Settings) => Promise<void>} saveSettingsFunc - saveSettings関数
 */
export async function saveSettingsWithAllowedUrls(
    settings: import('./storageSettings.js').Settings,
    saveSettingsFunc: (settings: import('./storageSettings.js').Settings) => Promise<void>
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

/**
 * 楽観的ロック用のバージョンフィールドを初期化（移行用）
 *
 * 新規インストールまたは既存データにバージョンフィールドがない場合に初期化します。
 * この関数はアプリ起動時に呼び出されることを想定しています。
 *
 * @returns {Promise<void>}
 */
export async function ensureUrlVersionInitialized(): Promise<void> {
    await ensureVersionInitialized('savedUrls');
    await ensureVersionInitialized('savedUrlsWithTimestamps');
}