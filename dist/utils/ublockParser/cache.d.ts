/**
 * ublockParser/cache.ts
 * uBlock Origin形式フィルターパーサーのキャッシュ管理
 *
 * 【機能概要】: パーサーのキャッシュ機能を提供
 * 🟢 信頼性レベル: UF-302 パフォーマンス最適化要件
 */
/**
 * LRUトラッカーを更新
 * @param {string} key - キャッシュキー
 */
export declare function updateLRUTracker(key: string): void;
/**
 * LRUキャッシュのクリーンアップ
 */
export declare function cleanupCache(): void;
/**
 * キャッシュキーを生成
 *
 * 【PERF-019修正】ハッシュベースのキー生成による衝突防止:
 * - 元の実践は先頭100文字と長さのみを使用しており、衝突リスクがあった
 * - FNV-1aハッシュ関数を使用して、テキスト全体を考慮した一意なキーを生成
 * - 長さも含めることで、追加の安全性を確保
 *
 * @param {string} text - キャッシュキーの元となるテキスト
 * @returns {string} - キャッシュキー（ハッシュ値と長さの組み合わせ）
 */
export declare function generateCacheKey(text: string): string;
/**
 * キャッシュから値を取得
 * @param {string} key - キャッシュキー
 * @returns {Object|null} - キャッシュされた値（存在しない場合はnull）
 */
export declare function getFromCache(key: string): any | null;
/**
 * キャッシュに値を保存
 * @param {string} key - キャッシュキー
 * @param {Object} value - 保存する値
 */
export declare function saveToCache(key: string, value: any): void;
/**
 * キャッシュがキーを持っているか判定
 * @param {string} key - キャッシュキー
 * @returns {boolean} - キャッシュにキーが存在するか
 */
export declare function hasCacheKey(key: string): boolean;
/**
 * キャッシュを完全にクリアする（テスト用）
 *
 * 【用途】:
 *   - テスト実行間のキャッシュ状態リセット
 *   - モジュールレベルの変数を初期化
 *
 * 【注意】:
 *   - 本番コードでの使用は推奨しない
 *   - cleanupCache()は時間ベースの条件付きクリア
 *   - clearCache()は無条件で完全クリア
 */
export declare function clearCache(): void;
//# sourceMappingURL=cache.d.ts.map