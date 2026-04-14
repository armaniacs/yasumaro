/**
 * urlMetadata.ts
 * URLエントリのメタデータ設定機能
 */

import { withOptimisticLock } from './optimisticLock.js';
import type { RecordType, AiSummaryCleansedReason } from './commonTypes.js';
import type { SavedUrlEntry, CleansedReason } from './urlEntry.js';

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

/**
 * URLエントリのAI要約クレンジング複数理由リストを設定する
 */
export async function setUrlAiSummaryCleansedReasons(url: string, aiSummaryCleansedReasons: string[]): Promise<void> {
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        const idx = entries.findIndex(e => e.url === url);
        if (idx >= 0) {
            const updatedEntries = [...entries];
            updatedEntries[idx] = { ...updatedEntries[idx], aiSummaryCleansedReasons };
            return updatedEntries;
        }
        return entries;
    });
}

/**
 * URLに使用したAIプロバイダー名を設定する
 * @param {string} url - 設定するURL
 * @param {string} aiProvider - AIプロバイダー名
 */
export async function setUrlAiProvider(url: string, aiProvider: string): Promise<void> {
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        const idx = entries.findIndex(e => e.url === url);
        if (idx >= 0) {
            const updatedEntries = [...entries];
            updatedEntries[idx] = { ...updatedEntries[idx], aiProvider };
            return updatedEntries;
        }
        return entries;
    });
}

/**
 * URLに使用したAIモデル名を設定する
 * @param {string} url - 設定するURL
 * @param {string} aiModel - AIモデル名
 */
export async function setUrlAiModel(url: string, aiModel: string): Promise<void> {
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        const idx = entries.findIndex(e => e.url === url);
        if (idx >= 0) {
            const updatedEntries = [...entries];
            updatedEntries[idx] = { ...updatedEntries[idx], aiModel };
            return updatedEntries;
        }
        return entries;
    });
}

/**
 * URLエントリのAI処理時間を設定する
 */
export async function setUrlAiDuration(url: string, aiDuration: number): Promise<void> {
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        const idx = entries.findIndex(e => e.url === url);
        if (idx >= 0) {
            const updatedEntries = [...entries];
            updatedEntries[idx] = { ...updatedEntries[idx], aiDuration };
            return updatedEntries;
        }
        return entries;
    });
}

/**
 * URLエントリのObsidian保存時間を設定する
 */
export async function setUrlObsidianDuration(url: string, obsidianDuration: number): Promise<void> {
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        const idx = entries.findIndex(e => e.url === url);
        if (idx >= 0) {
            const updatedEntries = [...entries];
            updatedEntries[idx] = { ...updatedEntries[idx], obsidianDuration };
            return updatedEntries;
        }
        return entries;
    });
}

/**
 * URLエントリのL0抽出後のバイト数を設定する
 */
export async function setUrlExtractedSentencesBytes(url: string, extractedSentencesBytes: number): Promise<void> {
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        const idx = entries.findIndex(e => e.url === url);
        if (idx >= 0) {
            const updatedEntries = [...entries];
            updatedEntries[idx] = { ...updatedEntries[idx], extractedSentencesBytes };
            return updatedEntries;
        }
        return entries;
    });
}

/**
 * URLエントリのL0抽出前のバイト数を設定する
 */
export async function setUrlExtractedSentencesOriginalBytes(url: string, extractedSentencesOriginalBytes: number): Promise<void> {
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        const idx = entries.findIndex(e => e.url === url);
        if (idx >= 0) {
            const updatedEntries = [...entries];
            updatedEntries[idx] = { ...updatedEntries[idx], extractedSentencesOriginalBytes };
            return updatedEntries;
        }
        return entries;
    });
}

export async function setUrlFallbackTriggered(url: string, fallbackTriggered: boolean): Promise<void> {
    // Strip hash inline (no getUrlWithoutHash util available)
    const validUrl = url.split('#')[0];
    const result = await chrome.storage.local.get('savedUrlsWithTimestamps');
    const entries = (result.savedUrlsWithTimestamps as SavedUrlEntry[]) || [];

    const entry = entries.find(e => e.url === validUrl);
    if (entry) {
        entry.fallbackTriggered = fallbackTriggered;
        await chrome.storage.local.set({ savedUrlsWithTimestamps: entries });
    }
}