/**
 * storage/quota.ts
 * chrome.storage.local usage/quota helpers shared by settingsStore and
 * savedUrlStore. Split out of storage.ts (PBI: storage.ts deepening).
 */

export const STORAGE_QUOTA_BYTES = 10 * 1024 * 1024; // 10MB (chrome.storage.local.QUOTA_BYTES)

/**
 * ストレージ使用量を取得
 * @returns {Promise<number>} 使用量（バイト）
 */
export async function getStorageUsage(): Promise<number> {
    return await chrome.storage.local.getBytesInUse();
}

/**
 * unlimitedStorage 権限が付与されているか確認
 * 本拡張機能は manifest で unlimitedStorage を宣言しているが、
 * 実行時チェックを残しておくことで将来の権限変更にも対応できる。
 */
export async function hasUnlimitedStorage(): Promise<boolean> {
    if (typeof chrome === 'undefined' || !chrome.permissions) {
        return false;
    }
    try {
        return await chrome.permissions.contains({ permissions: ['unlimitedStorage'] });
    } catch {
        return false;
    }
}

/**
 * 新しいデータのサイズを推定
 * @param {unknown} data - データ
 * @returns {number} サイズ（バイト）
 */
export function estimateDataSize(data: unknown): number {
    return new Blob([JSON.stringify(data || {})]).size;
}
