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
    tags?: string[];  // タグリスト（オプション）
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
    const urlArray = Array.from(urlMap.keys());

    // savedUrlsWithTimestampsの楽観的ロックを使用
    // 既存エントリの recordType / maskedCount / tags を保持しつつ timestamp だけ更新する
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const existingMap = new Map<string, SavedUrlEntry>();
        for (const e of (currentEntries || [])) {
            existingMap.set(e.url, e);
        }
        const entries: SavedUrlEntry[] = [];
        for (const [url, timestamp] of urlMap.entries()) {
            const existing = existingMap.get(url);
            const entry: SavedUrlEntry = { url, timestamp };
            if (existing?.recordType !== undefined) entry.recordType = existing.recordType;
            if (existing?.maskedCount !== undefined) entry.maskedCount = existing.maskedCount;
            if (existing?.tags !== undefined) entry.tags = existing.tags;
            entries.push(entry);
        }
        return entries;
    }, { maxRetries: 5 });

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
 * 【recordType上書き競合対策】楽観的ロックを使用して安全に更新
 * @param {string} url - 更新するURL
 * @param {RecordType} [recordType] - 記録方式
 */
async function updateUrlTimestamp(url: string, recordType?: RecordType): Promise<void> {
    // 【recordType上書き競合対策】楽観的ロックを使用
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        let entries = currentEntries || [];

        // 既存のURLエントリを取得してから削除
        const existing = entries.find(entry => entry.url === url);
        entries = entries.filter(entry => entry.url !== url);

        // 新しいエントリを追加（既存の tags / maskedCount を引き継ぐ）
        const entry: SavedUrlEntry = { url, timestamp: Date.now() };
        if (recordType) entry.recordType = recordType;
        if (existing?.maskedCount !== undefined) entry.maskedCount = existing.maskedCount;
        if (existing?.tags !== undefined) entry.tags = existing.tags;
        entries.push(entry);

        // 7日より古いエントリを削除（日数ベース）
        const cutoff = Date.now() - URL_RETENTION_DAYS * 24 * 60 * 60 * 1000;
        entries = entries.filter(entry => entry.timestamp >= cutoff);

        // それでもMAX_URL_SET_SIZEを超える場合は古い順にLRU削除
        if (entries.length > MAX_URL_SET_SIZE) {
            entries.sort((a, b) => a.timestamp - b.timestamp);
            entries = entries.slice(entries.length - MAX_URL_SET_SIZE);
        }

        return entries;
    }, { maxRetries: 5 });

    // savedUrlsセットも同期（isUrlSaved, getSavedUrlCountで使用）
    await withOptimisticLock('savedUrls', (currentUrls: string[]) => {
        const currentSet = new Set(currentUrls || []);
        currentSet.add(url);
        return Array.from(currentSet);
    }, { maxRetries: 5 });
}

/**
 * URLを保存リストに追加（LRU追跡付き、日付ベース対応）
 * @param {string} url - 追加するURL
 * @param {RecordType} [recordType] - 記録方式
 */
export async function addSavedUrl(url: string, recordType?: RecordType): Promise<void> {
    recordType ? await updateUrlTimestamp(url, recordType) : await updateUrlTimestamp(url);
    // recordTypeを含めて1回の書き込みで完了
}

/**
 * 記録済みURLのrecordTypeを更新する
 * 【recordType上書き競合対策】楽観的ロックを使用して安全に更新
 * @param {string} url - 更新するURL
 * @param {RecordType} recordType - 記録方式
 */
export async function setUrlRecordType(url: string, recordType: RecordType): Promise<void> {
    // 【recordType上書き競合対策】楽観的ロックを使用
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        const idx = entries.findIndex(e => e.url === url);
        if (idx >= 0) {
            // 既存のエントリをコピーしてrecordTypeを追加
            const updatedEntries = [...entries];
            updatedEntries[idx] = { ...updatedEntries[idx], recordType };
            return updatedEntries;
        }
        return entries;
    }, { maxRetries: 5 });
}

/**
 * 記録済みURLのmaskedCountを更新する
 * 【recordType上書き競合対策】楽観的ロックを使用して安全に更新
 * @param {string} url - 更新するURL
 * @param {number} maskedCount - マスクしたPII件数
 */
export async function setUrlMaskedCount(url: string, maskedCount: number): Promise<void> {
    // 【recordType上書き競合対策】楽観的ロックを使用
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        const idx = entries.findIndex(e => e.url === url);
        if (idx >= 0) {
            // 既存のエントリをコピーしてmaskedCountを追加
            const updatedEntries = [...entries];
            updatedEntries[idx] = { ...updatedEntries[idx], maskedCount };
            return updatedEntries;
        }
        return entries;
    }, { maxRetries: 5 });
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
    const protocol = (settings.obsidian_protocol as string) || 'https';
    const port = (settings.obsidian_port as string) || '27124';
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

// ============================================================================
// タグ管理機能
// ============================================================================

/**
 * URLのタグを設定する
 * 【楽観的ロックを使用して安全に更新】
 * @param {string} url - 設定するURL
 * @param {string[]} tags - 設定するタグリスト
 * @returns {Promise<void>}
 */
export async function setUrlTags(url: string, tags: string[]): Promise<void> {
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        const targetEntry = entries.find(e => e.url === url);
        if (targetEntry) {
            targetEntry.tags = tags;
        }
        return entries;
    }, { maxRetries: 5 });
}

/**
 * URLにタグを追加する
 * 【楽観的ロックを使用して安全に更新】
 * @param {string} url - URL
 * @param {string} tag - 追加するタグ
 * @returns {Promise<void>}
 */
export async function addUrlTag(url: string, tag: string): Promise<void> {
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        const targetEntry = entries.find(e => e.url === url);
        if (targetEntry) {
            if (!targetEntry.tags) {
                targetEntry.tags = [];
            }
            if (!targetEntry.tags.includes(tag)) {
                targetEntry.tags.push(tag);
            }
        }
        return entries;
    }, { maxRetries: 5 });
}

/**
 * URLからタグを削除する
 * 【楽観的ロックを使用して安全に更新】
 * @param {string} url - URL
 * @param {string} tag - 削除するタグ
 * @returns {Promise<void>}
 */
export async function removeUrlTag(url: string, tag: string): Promise<void> {
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        const targetEntry = entries.find(e => e.url === url);
        if (targetEntry && targetEntry.tags) {
            targetEntry.tags = targetEntry.tags.filter(t => t !== tag);
            // 空配列になった場合はundefinedにする（未設定との区別）
            if (targetEntry.tags.length === 0) {
                targetEntry.tags = undefined;
            }
        }
        return entries;
    }, { maxRetries: 5 });
}