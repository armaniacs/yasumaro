/**
 * ublockParser/cache.ts
 * uBlock Origin形式フィルターパーサーのキャッシュ管理
 *
 * 【機能概要】: パーサーのキャッシュ機能を提供
 * 🟢 信頼性レベル: UF-302 パフォーマンス最適化要件
 */
import { CACHE_CONFIG, CLEANUP_INTERVAL } from './constants.js';
// ============================================================================
// キャッシュ管理
// ============================================================================
/** 【キャッシュ】: パーサーキャッシュ 🟢 */
const PARSER_CACHE = new Map();
/** 【LRUキャッシュ】: 最近使用されたエントリを追跡 */
const LRU_TRACKER = new Set();
// 最後にクリーンアップした時間
let lastCleanupTime = Date.now();
// ============================================================================
// PERF-019修正: ハッシュ関数によるキャッシュキー衝突防止
// ============================================================================
/**
 * 高速ハッシュ関数 - FNV-1a 32bit
 * 小さな差異でも異なるハッシュ値を生成し、キャッシュキー衝突を防止
 * @param {string} str - ハッシュ対象の文字列
 * @returns {string} - 32bitハッシュ値（正整数に変換して文字列化）
 */
function hashString(str) {
    // FNV-1aハッシュ定数（32bit）
    const FNV_OFFSET_BASIS = 0x811c9dc5;
    const FNV_PRIME = 0x01000193;
    let hash = FNV_OFFSET_BASIS;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, FNV_PRIME);
    }
    // 正整数に変換して返す（安全性のため32bitにマスク）
    return (hash >>> 0).toString(36);
}
/**
 * LRUキャッシュから最も古いエントリを削除
 */
function evictLRUEntry() {
    const firstKey = LRU_TRACKER.values().next().value;
    if (firstKey !== undefined) {
        LRU_TRACKER.delete(firstKey);
        PARSER_CACHE.delete(firstKey);
    }
}
/**
 * LRUトラッカーを更新
 * @param {string} key - キャッシュキー
 */
export function updateLRUTracker(key) {
    // 既存のキーを削除
    LRU_TRACKER.delete(key);
    // キーを最後に追加（最近使用）
    LRU_TRACKER.add(key);
    // LRUキャッシュの最大サイズを超えた場合は最も古いエントリを削除
    if (LRU_TRACKER.size > CACHE_CONFIG.LRU_MAX_ENTRIES) {
        evictLRUEntry();
    }
}
/**
 * LRUキャッシュのクリーンアップ
 */
export function cleanupCache() {
    const now = Date.now();
    if (now - lastCleanupTime > CLEANUP_INTERVAL) {
        PARSER_CACHE.clear();
        LRU_TRACKER.clear();
        lastCleanupTime = now;
    }
}
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
export function generateCacheKey(text) {
    const hash = hashString(text);
    return `${hash}_${text.length}`;
}
/**
 * キャッシュから値を取得
 * @param {string} key - キャッシュキー
 * @returns {Object|null} - キャッシュされた値（存在しない場合はnull）
 */
export function getFromCache(key) {
    if (PARSER_CACHE.has(key)) {
        updateLRUTracker(key);
        return { ...PARSER_CACHE.get(key) }; // ディープコピーして返す
    }
    return null;
}
/**
 * キャッシュに値を保存
 * @param {string} key - キャッシュキー
 * @param {Object} value - 保存する値
 */
export function saveToCache(key, value) {
    updateLRUTracker(key);
    PARSER_CACHE.set(key, value);
}
/**
 * キャッシュがキーを持っているか判定
 * @param {string} key - キャッシュキー
 * @returns {boolean} - キャッシュにキーが存在するか
 */
export function hasCacheKey(key) {
    return PARSER_CACHE.has(key);
}
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
export function clearCache() {
    PARSER_CACHE.clear();
    LRU_TRACKER.clear();
    lastCleanupTime = Date.now();
}
//# sourceMappingURL=cache.js.map