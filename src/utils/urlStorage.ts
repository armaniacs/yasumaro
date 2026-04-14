/**
 * urlStorage.ts
 * URL管理関連の機能 - 基本的なURL保存・取得機能
 */

import { withOptimisticLock } from './optimisticLock.js';
import type { RecordType } from './commonTypes.js';
import type { SavedUrlEntry } from './urlEntry.js';
import { MAX_URL_SET_SIZE, URL_RETENTION_DAYS, MAX_CONTENT_ENTRIES } from './urlEntry.js';

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
    // 既存エントリの recordType / maskedCount / tags / content / aiSummary / sentTokens / receivedTokens / originalTokens / cleansedTokens / originalBytes / cleansedBytes / aiSummaryOriginalBytes / aiSummaryCleansedBytes / aiSummaryCleansedElements / aiSummaryCleansedReason を保持しつつ timestamp だけ更新する
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
            if (existing?.content !== undefined) entry.content = existing.content;
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
            if (existing?.aiSummaryCleansedReasons !== undefined) entry.aiSummaryCleansedReasons = existing.aiSummaryCleansedReasons;
            if (existing?.pageBytes !== undefined) entry.pageBytes = existing.pageBytes;
            if (existing?.candidateBytes !== undefined) entry.candidateBytes = existing.candidateBytes;
            if (existing?.aiProvider !== undefined) entry.aiProvider = existing.aiProvider;
            if (existing?.aiModel !== undefined) entry.aiModel = existing.aiModel;
            if (existing?.aiDuration !== undefined) entry.aiDuration = existing.aiDuration;
            if (existing?.obsidianDuration !== undefined) entry.obsidianDuration = existing.obsidianDuration;
            entries.push(entry);
        }
        // contentは最新MAX_CONTENT_ENTRIES件のみ保持（ストレージ節約）
        const sorted = entries.slice().sort((a, b) => b.timestamp - a.timestamp);
        sorted.forEach((e, i) => { if (i >= MAX_CONTENT_ENTRIES) delete e.content; });
        return entries;
    });

    // savedUrlsがsavedUrlsWithTimestampsと同期されていない場合は個別に更新
    // (互換性維持のため、savedUrlsも保存する)
    // withOptimisticLockを使用して原子的に更新
    await withOptimisticLock('savedUrls', (currentUrls: string[]) => {
        const currentSet = new Set(currentUrls || []);
        const newSet = new Set(urlArray);

        // サイズが異なる場合は即座に更新
        if (currentSet.size !== newSet.size) {
            return Array.from(newSet);
        }

        // for...ofループで比較（O(n)配列アロケーションなし）
        for (const x of currentSet) {
            if (!newSet.has(x)) {
                return Array.from(newSet);
            }
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

        // 新しいエントリを追加（既存の tags / maskedCount / content / cleansedReason / aiSummary / sentTokens / receivedTokens / originalTokens / cleansedTokens / originalBytes / cleansedBytes / aiSummaryOriginalBytes / aiSummaryCleansedBytes / aiSummaryCleansedElements / aiSummaryCleansedReason を引き継ぐ）
        const entry: SavedUrlEntry = { url, timestamp: Date.now() };
        if (recordType) entry.recordType = recordType;
        if (existing?.maskedCount !== undefined) entry.maskedCount = existing.maskedCount;
        if (existing?.tags !== undefined) entry.tags = existing.tags;
        if (existing?.content !== undefined) entry.content = existing.content;
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
        if (existing?.aiSummaryCleansedReasons !== undefined) entry.aiSummaryCleansedReasons = existing.aiSummaryCleansedReasons;
        if (existing?.pageBytes !== undefined) entry.pageBytes = existing.pageBytes;
        if (existing?.candidateBytes !== undefined) entry.candidateBytes = existing.candidateBytes;
        if (existing?.aiProvider !== undefined) entry.aiProvider = existing.aiProvider;
        if (existing?.aiModel !== undefined) entry.aiModel = existing.aiModel;
        if (existing?.aiDuration !== undefined) entry.aiDuration = existing.aiDuration;
        if (existing?.obsidianDuration !== undefined) entry.obsidianDuration = existing.obsidianDuration;
        entries.push(entry);

        // 7日より古いエントリを削除（日数ベース）
        const cutoff = Date.now() - URL_RETENTION_DAYS * 24 * 60 * 60 * 1000;
        entries = entries.filter(entry => entry.timestamp >= cutoff);

        // それでもMAX_URL_SET_SIZEを超える場合は古い順にLRU削除
        if (entries.length > MAX_URL_SET_SIZE) {
            entries.sort((a, b) => a.timestamp - b.timestamp);
            entries = entries.slice(entries.length - MAX_URL_SET_SIZE);
        }

        // contentは最新MAX_CONTENT_ENTRIES件のみ保持（ストレージ節約）
        const sorted = entries.slice().sort((a, b) => b.timestamp - a.timestamp);
        sorted.forEach((e, i) => { if (i >= MAX_CONTENT_ENTRIES) delete e.content; });

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