/**
 * storageUrls.ts
 * URL管理関連の機能
 * 保存URLの管理、LRU追跡、許可URLリストの構築
 */
export declare const MAX_URL_SET_SIZE = 10000;
export declare const URL_WARNING_THRESHOLD = 8000;
export declare const URL_RETENTION_DAYS = 7;
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
export declare function getSavedUrls(): Promise<Set<string>>;
/**
 * タイムスタンプ付きの詳細なURLエントリを取得
 * @returns {Promise<Map<string, number>>} URLからタイムスタンプへのマップ
 */
export declare function getSavedUrlsWithTimestamps(): Promise<Map<string, number>>;
/**
 * 記録方式を含む詳細なURLエントリをすべて取得
 * @returns {Promise<SavedUrlEntry[]>} 保存されたURLエントリの配列
 */
export declare function getSavedUrlEntries(): Promise<SavedUrlEntry[]>;
/**
 * URLのリストを保存（LRU削除有効）
 * @param {Set<string>} urlSet - 保存するURLのセット
 * @param {string} [urlToAdd] - 追加/更新するURL（現在のタイムスタンプ付き）（オプション）
 */
export declare function setSavedUrls(urlSet: Set<string>, urlToAdd?: string | null): Promise<void>;
/**
 * タイムスタンプ付きのURL Mapを保存（日付ベース重複チェック用）
 * @param {Map<string, number>} urlMap - URLからタイムスタンプへのマップ
 * @param {string} [urlToAdd] - 追加/更新するURL（現在のタイムスタンプ付き）（オプション）
 */
export declare function setSavedUrlsWithTimestamps(urlMap: Map<string, number>, urlToAdd?: string | null): Promise<void>;
/**
 * URLを保存リストに追加（LRU追跡付き、日付ベース対応）
 * @param {string} url - 追加するURL
 * @param {RecordType} [recordType] - 記録方式
 */
export declare function addSavedUrl(url: string, recordType?: RecordType): Promise<void>;
/**
 * 記録済みURLのrecordTypeを更新する
 * 【recordType上書き競合対策】楽観的ロックを使用して安全に更新
 * @param {string} url - 更新するURL
 * @param {RecordType} recordType - 記録方式
 */
export declare function setUrlRecordType(url: string, recordType: RecordType): Promise<void>;
/**
 * 記録済みURLのmaskedCountを更新する
 * 【recordType上書き競合対策】楽観的ロックを使用して安全に更新
 * @param {string} url - 更新するURL
 * @param {number} maskedCount - マスクしたPII件数
 */
export declare function setUrlMaskedCount(url: string, maskedCount: number): Promise<void>;
/**
 * URLを保存リストから削除
 * @param {string} url - 削除するURL
 */
export declare function removeSavedUrl(url: string): Promise<void>;
/**
 * URLが保存リストに含まれているかチェック
 * @param {string} url - チェックするURL
 * @returns {Promise<boolean>} URLが保存されている場合はtrue
 */
export declare function isUrlSaved(url: string): Promise<boolean>;
/**
 * 保存されたURLの件数を取得
 * @returns {Promise<number>} 保存されたURLの件数
 */
export declare function getSavedUrlCount(): Promise<number>;
/**
 * 設定から許可されたURLのリストを構築
 * @param {Record<string, unknown>} settings - 設定オブジェクト
 * @param {(url: string) => boolean} isDomainInWhitelistFunc - ドメインチェック関数
 * @returns {Set<string>} 許可されたURLのセット
 */
export declare function buildAllowedUrls(settings: Record<string, unknown>, isDomainInWhitelistFunc: (url: string) => boolean): Set<string>;
/**
 * URLリストのハッシュを計算
 * @param {Set<string>} urls - URLのセット
 * @returns {string} ハッシュ値
 */
export declare function computeUrlsHash(urls: Set<string>): string;
/**
 * 設定を保存し、許可されたURLのリストを再構築
 * @param {import('./storageSettings.js').Settings} settings - 設定オブジェクト
 * @param {(settings: import('./storageSettings.js').Settings) => Promise<void>} saveSettingsFunc - saveSettings関数
 */
export declare function saveSettingsWithAllowedUrls(settings: import('./storageSettings.js').Settings, saveSettingsFunc: (settings: import('./storageSettings.js').Settings) => Promise<void>): Promise<void>;
/**
 * 許可されたURLのリストを取得
 * @param {string} ALLOWED_URLS_KEY - 許可URLのストレージキー
 * @returns {Promise<Set<string>>} 許可されたURLのセット
 */
export declare function getAllowedUrls(ALLOWED_URLS_KEY: string): Promise<Set<string>>;
/**
 * 楽観的ロック用のバージョンフィールドを初期化（移行用）
 *
 * 新規インストールまたは既存データにバージョンフィールドがない場合に初期化します。
 * この関数はアプリ起動時に呼び出されることを想定しています。
 *
 * @returns {Promise<void>}
 */
export declare function ensureUrlVersionInitialized(): Promise<void>;
//# sourceMappingURL=storageUrls.d.ts.map