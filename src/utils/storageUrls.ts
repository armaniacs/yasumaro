/**
 * storageUrls.ts
 * URL管理関連の機能
 * 保存URLの管理、LRU追跡、許可URLリストの構築
 */

import { withOptimisticLock } from './optimisticLock.js';
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
 * クレンジング実行理由
 */
export type CleansedReason = 'hard' | 'keyword' | 'both' | 'none';

/**
 * AI要約クレンジング実行理由
 */
export type AiSummaryCleansedReason = 'alt' | 'metadata' | 'ads' | 'nav' | 'social' | 'deep' | 'multiple' | 'none';

/**
 * 保存されたURLエントリ
 */
export interface SavedUrlEntry {
    url: string;
    timestamp: number;
    recordType?: RecordType;
    maskedCount?: number;
    tags?: string[];  // タグリスト（オプション）
    content?: string;  // 抽出されたコンテンツ（クレンジング後）
    cleansedReason?: CleansedReason;  // クレンジング実行理由
    aiSummary?: string;  // AI要約（オプション）
    sentTokens?: number;  // 送信トークン数（オプション）
    receivedTokens?: number;  // 受信トークン数（オプション）
    originalTokens?: number;  // 元のトークン数（オプション）
    cleansedTokens?: number;  // クレンジング後のトークン数（オプション）
    pageBytes?: number;       // findMainContentCandidates() 前のバイト数（オプション）
    candidateBytes?: number;  // findMainContentCandidates() 後のバイト数（オプション）
    originalBytes?: number;   // 元のバイト数（オプション）
    cleansedBytes?: number;   // クレンジング後のバイト数（オプション）
    aiSummaryOriginalBytes?: number;  // AI要約クレンジング前のバイト数（オプション）
    aiSummaryCleansedBytes?: number;  // AI要約クレンジング後のバイト数（オプション）
    aiSummaryCleansedElements?: number;  // AI要約クレンジングで削除した要素数（オプション）
    aiSummaryCleansedReason?: AiSummaryCleansedReason;  // AI要約クレンジング実行理由（オプション）
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
    await withOptimisticLock('savedUrls', () => urlArray);

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
    // 既存エントリの recordType / maskedCount / tags / aiSummary / sentTokens / receivedTokens / originalTokens / cleansedTokens / originalBytes / cleansedBytes / aiSummaryOriginalBytes / aiSummaryCleansedBytes / aiSummaryCleansedElements / aiSummaryCleansedReason を保持しつつ timestamp だけ更新する
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
            if (existing?.aiSummary !== undefined) entry.aiSummary = existing.aiSummary;
            if (existing?.sentTokens !== undefined) entry.sentTokens = existing.sentTokens;
            if (existing?.receivedTokens !== undefined) entry.receivedTokens = existing.receivedTokens;
            if (existing?.originalTokens !== undefined) entry.originalTokens = existing.originalTokens;
            if (existing?.cleansedTokens !== undefined) entry.cleansedTokens = existing.cleansedTokens;
            if (existing?.originalBytes !== undefined) entry.originalBytes = existing.originalBytes;
            if (existing?.cleansedBytes !== undefined) entry.cleansedBytes = existing.cleansedBytes;
            if (existing?.aiSummaryOriginalBytes !== undefined) entry.aiSummaryOriginalBytes = existing.aiSummaryOriginalBytes;
            if (existing?.aiSummaryCleansedBytes !== undefined) entry.aiSummaryCleansedBytes = existing.aiSummaryCleansedBytes;
            if (existing?.aiSummaryCleansedElements !== undefined) entry.aiSummaryCleansedElements = existing.aiSummaryCleansedElements;
            if (existing?.aiSummaryCleansedReason !== undefined) entry.aiSummaryCleansedReason = existing.aiSummaryCleansedReason;
            entries.push(entry);
        }
        return entries;
    });

    // savedUrlsがsavedUrlsWithTimestampsと同期されていない場合は個別に更新
    // (互換性維持のため、savedUrlsも保存する)
    // withOptimisticLockを使用して原子的に更新
    await withOptimisticLock('savedUrls', (currentUrls: string[]) => {
        const currentSet = new Set(currentUrls || []);
        const newSet = new Set(urlArray);

        // Set ネイティブ操作で比較（O(n) より効率的）
        if (currentSet.size !== newSet.size || ![...currentSet].every(x => newSet.has(x))) {
            return Array.from(newSet);
        }

        return currentUrls; // 変更なしの場合は元の値を返す
    });
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

        // 新しいエントリを追加（既存の tags / maskedCount / cleansedReason / aiSummary / sentTokens / receivedTokens / originalTokens / cleansedTokens / originalBytes / cleansedBytes / aiSummaryOriginalBytes / aiSummaryCleansedBytes / aiSummaryCleansedElements / aiSummaryCleansedReason を引き継ぐ）
        const entry: SavedUrlEntry = { url, timestamp: Date.now() };
        if (recordType) entry.recordType = recordType;
        if (existing?.maskedCount !== undefined) entry.maskedCount = existing.maskedCount;
        if (existing?.tags !== undefined) entry.tags = existing.tags;
        if (existing?.cleansedReason !== undefined) entry.cleansedReason = existing.cleansedReason;
        if (existing?.aiSummary !== undefined) entry.aiSummary = existing.aiSummary;
        if (existing?.sentTokens !== undefined) entry.sentTokens = existing.sentTokens;
        if (existing?.receivedTokens !== undefined) entry.receivedTokens = existing.receivedTokens;
        if (existing?.originalTokens !== undefined) entry.originalTokens = existing.originalTokens;
        if (existing?.cleansedTokens !== undefined) entry.cleansedTokens = existing.cleansedTokens;
        if (existing?.originalBytes !== undefined) entry.originalBytes = existing.originalBytes;
        if (existing?.cleansedBytes !== undefined) entry.cleansedBytes = existing.cleansedBytes;
        if (existing?.aiSummaryOriginalBytes !== undefined) entry.aiSummaryOriginalBytes = existing.aiSummaryOriginalBytes;
        if (existing?.aiSummaryCleansedBytes !== undefined) entry.aiSummaryCleansedBytes = existing.aiSummaryCleansedBytes;
        if (existing?.aiSummaryCleansedElements !== undefined) entry.aiSummaryCleansedElements = existing.aiSummaryCleansedElements;
        if (existing?.aiSummaryCleansedReason !== undefined) entry.aiSummaryCleansedReason = existing.aiSummaryCleansedReason;
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
    });

    // savedUrlsセットも同期（isUrlSaved, getSavedUrlCountで使用）
    await withOptimisticLock('savedUrls', (currentUrls: string[]) => {
        const currentSet = new Set(currentUrls || []);
        currentSet.add(url);
        return Array.from(currentSet);
    });
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
    });
}

/**
 * 記録済みURLのcontentを保存する
 * 【楽観的ロックを使用して安全に更新】
 * @param {string} url - 更新するURL
 * @param {string} content - 抽出されたコンテンツ
 */
export async function setUrlContent(url: string, content: string): Promise<void> {
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        const idx = entries.findIndex(e => e.url === url);
        if (idx >= 0) {
            const updatedEntries = [...entries];
            updatedEntries[idx] = { ...updatedEntries[idx], content };
            return updatedEntries;
        }
        return entries;
    });
}

/**
 * 記録済みURLのcleansedReasonを更新する
 * 【楽観的ロックを使用して安全に更新】
 * @param {string} url - 更新するURL
 * @param {CleansedReason} cleansedReason - クレンジング実行理由
 */
export async function setUrlCleansedReason(url: string, cleansedReason: CleansedReason): Promise<void> {
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        const idx = entries.findIndex(e => e.url === url);
        if (idx >= 0) {
            const updatedEntries = [...entries];
            updatedEntries[idx] = { ...updatedEntries[idx], cleansedReason };
            return updatedEntries;
        }
        return entries;
    });
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
    });
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
    });

    // タイムスタンプ管理からも削除
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        return entries.filter(entry => entry.url !== url);
    });
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
            // 空配列の場合は undefined に設定（未設定との区別）
            targetEntry.tags = tags.length > 0 ? tags : undefined;
        } else {
            // URLが存在しない場合はサイレント失敗（ログで追跡可能）
            console.warn(`[setUrlTags] URL not found in savedUrlsWithTimestamps: ${url}`);
        }
        return entries;
    });
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
    });
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
    });
}

/**
 * URLのAI要約を設定する
 * 【楽観的ロックを使用して安全に更新】
 * @param {string} url - 設定するURL
 * @param {string} aiSummary - AI要約
 * @returns {Promise<void>}
 */
export async function setUrlAiSummary(url: string, aiSummary: string): Promise<void> {
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        const idx = entries.findIndex(e => e.url === url);
        if (idx >= 0) {
            const updatedEntries = [...entries];
            updatedEntries[idx] = { ...updatedEntries[idx], aiSummary };
            return updatedEntries;
        }
        return entries;
    });
}

/**
 * URLの送信トークン数を設定する
 * 【楽観的ロックを使用して安全に更新】
 * @param {string} url - 設定するURL
 * @param {number} sentTokens - 送信トークン数
 * @returns {Promise<void>}
 */
export async function setUrlSentTokens(url: string, sentTokens: number): Promise<void> {
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        const idx = entries.findIndex(e => e.url === url);
        if (idx >= 0) {
            const updatedEntries = [...entries];
            updatedEntries[idx] = { ...updatedEntries[idx], sentTokens };
            return updatedEntries;
        }
        return entries;
    });
}

/**
 * URLの受信トークン数を設定する
 * 【楽観的ロックを使用して安全に更新】
 * @param {string} url - 設定するURL
 * @param {number} receivedTokens - 受信トークン数
 * @returns {Promise<void>}
 */
export async function setUrlReceivedTokens(url: string, receivedTokens: number): Promise<void> {
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        const idx = entries.findIndex(e => e.url === url);
        if (idx >= 0) {
            const updatedEntries = [...entries];
            updatedEntries[idx] = { ...updatedEntries[idx], receivedTokens };
            return updatedEntries;
        }
        return entries;
    });
}

/**
 * URLの元のトークン数を設定する
 * 【楽観的ロックを使用して安全に更新】
 * @param {string} url - 設定するURL
 * @param {number} originalTokens - 元のトークン数
 * @returns {Promise<void>}
 */
export async function setUrlOriginalTokens(url: string, originalTokens: number): Promise<void> {
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        const idx = entries.findIndex(e => e.url === url);
        if (idx >= 0) {
            const updatedEntries = [...entries];
            updatedEntries[idx] = { ...updatedEntries[idx], originalTokens };
            return updatedEntries;
        }
        return entries;
    });
}

/**
 * URLのクレンジング後のトークン数を設定する
 * 【楽観的ロックを使用して安全に更新】
 * @param {string} url - 設定するURL
 * @param {number} cleansedTokens - クレンジング後のトークン数
 * @returns {Promise<void>}
 */
export async function setUrlCleansedTokens(url: string, cleansedTokens: number): Promise<void> {
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        const idx = entries.findIndex(e => e.url === url);
        if (idx >= 0) {
            const updatedEntries = [...entries];
            updatedEntries[idx] = { ...updatedEntries[idx], cleansedTokens };
            return updatedEntries;
        }
        return entries;
    });
}

/**
 * URLのページ全体バイト数を設定する（findMainContentCandidates() 前）
 */
export async function setUrlPageBytes(url: string, pageBytes: number): Promise<void> {
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        const idx = entries.findIndex(e => e.url === url);
        if (idx >= 0) {
            const updatedEntries = [...entries];
            updatedEntries[idx] = { ...updatedEntries[idx], pageBytes };
            return updatedEntries;
        }
        return entries;
    });
}

/**
 * URLの候補要素バイト数を設定する（findMainContentCandidates() 後）
 */
export async function setUrlCandidateBytes(url: string, candidateBytes: number): Promise<void> {
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        const idx = entries.findIndex(e => e.url === url);
        if (idx >= 0) {
            const updatedEntries = [...entries];
            updatedEntries[idx] = { ...updatedEntries[idx], candidateBytes };
            return updatedEntries;
        }
        return entries;
    });
}

/**
 * URLの元のバイト数を設定する
 * 【楽観的ロックを使用して安全に更新】
 * @param {string} url - 設定するURL
 * @param {number} originalBytes - 元のバイト数
 * @returns {Promise<void>}
 */
export async function setUrlOriginalBytes(url: string, originalBytes: number): Promise<void> {
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        const idx = entries.findIndex(e => e.url === url);
        if (idx >= 0) {
            const updatedEntries = [...entries];
            updatedEntries[idx] = { ...updatedEntries[idx], originalBytes };
            return updatedEntries;
        }
        return entries;
    });
}

/**
 * URLのクレンジング後のバイト数を設定する
 * 【楽観的ロックを使用して安全に更新】
 * @param {string} url - 設定するURL
 * @param {number} cleansedBytes - クレンジング後のバイト数
 * @returns {Promise<void>}
 */
export async function setUrlCleansedBytes(url: string, cleansedBytes: number): Promise<void> {
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        const idx = entries.findIndex(e => e.url === url);
        if (idx >= 0) {
            const updatedEntries = [...entries];
            updatedEntries[idx] = { ...updatedEntries[idx], cleansedBytes };
            return updatedEntries;
        }
        return entries;
    });
}

/**
 * URLのAI要約クレンジング前のバイト数を設定する
 * 【楽観的ロックを使用して安全に更新】
 * @param {string} url - 設定するURL
 * @param {number} aiSummaryOriginalBytes - AI要約クレンジング前のバイト数
 * @returns {Promise<void>}
 */
export async function setUrlAiSummaryOriginalBytes(url: string, aiSummaryOriginalBytes: number): Promise<void> {
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        const idx = entries.findIndex(e => e.url === url);
        if (idx >= 0) {
            const updatedEntries = [...entries];
            updatedEntries[idx] = { ...updatedEntries[idx], aiSummaryOriginalBytes };
            return updatedEntries;
        }
        return entries;
    });
}

/**
 * URLのAI要約クレンジング後のバイト数を設定する
 * 【楽観的ロックを使用して安全に更新】
 * @param {string} url - 設定するURL
 * @param {number} aiSummaryCleansedBytes - AI要約クレンジング後のバイト数
 * @returns {Promise<void>}
 */
export async function setUrlAiSummaryCleansedBytes(url: string, aiSummaryCleansedBytes: number): Promise<void> {
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        const idx = entries.findIndex(e => e.url === url);
        if (idx >= 0) {
            const updatedEntries = [...entries];
            updatedEntries[idx] = { ...updatedEntries[idx], aiSummaryCleansedBytes };
            return updatedEntries;
        }
        return entries;
    });
}

/**
 * URLのAI要約クレンジングで削除した要素数を設定する
 * 【楽観的ロックを使用して安全に更新】
 * @param {string} url - 設定するURL
 * @param {number} aiSummaryCleansedElements - AI要約クレンジングで削除した要素数
 * @returns {Promise<void>}
 */
export async function setUrlAiSummaryCleansedElements(url: string, aiSummaryCleansedElements: number): Promise<void> {
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        const idx = entries.findIndex(e => e.url === url);
        if (idx >= 0) {
            const updatedEntries = [...entries];
            updatedEntries[idx] = { ...updatedEntries[idx], aiSummaryCleansedElements };
            return updatedEntries;
        }
        return entries;
    });
}

/**
 * URLのAI要約クレンジング実行理由を設定する
 * 【楽観的ロックを使用して安全に更新】
 * @param {string} url - 設定するURL
 * @param {AiSummaryCleansedReason} aiSummaryCleansedReason - AI要約クレンジング実行理由
 * @returns {Promise<void>}
 */
export async function setUrlAiSummaryCleansedReason(url: string, aiSummaryCleansedReason: AiSummaryCleansedReason): Promise<void> {
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        const idx = entries.findIndex(e => e.url === url);
        if (idx >= 0) {
            const updatedEntries = [...entries];
            updatedEntries[idx] = { ...updatedEntries[idx], aiSummaryCleansedReason };
            return updatedEntries;
        }
        return entries;
    });
}
