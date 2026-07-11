/**
 * storage/quota.ts
 * chrome.storage.local usage/quota helpers shared by settingsStore and
 * savedUrlStore. Split out of storage.ts (PBI: storage.ts deepening).
 */

export const STORAGE_QUOTA_BYTES = 5 * 1024 * 1024; // 5MB (Chrome拡張機能のデフォルト)

/**
 * ストレージ使用量を取得
 * @returns {Promise<number>} 使用量（バイト）
 */
export async function getStorageUsage(): Promise<number> {
    return await chrome.storage.local.getBytesInUse();
}

/**
 * 新しいデータのサイズを推定
 * @param {unknown} data - データ
 * @returns {number} サイズ（バイト）
 */
export function estimateDataSize(data: unknown): number {
    return new Blob([JSON.stringify(data || {})]).size;
}
