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
const PARSER_CACHE = new Map<string, unknown>();
/** 【LRUキャッシュ】: 最近使用されたエントリを追跡 */
const LRU_TRACKER = new Set<string>();

// 最後にクリーンアップした時間
let lastCleanupTime = Date.now();

// ============================================================================
// VULN-003 fix: cache keys are the full filter text (see generateCacheKey)
// ============================================================================

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
export function updateLRUTracker(key: string) {
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
 * The key is the full filter text, so the key equivalence class is exactly
 * string equality. The previous PERF-019 key (FNV-1a 32-bit + length) kept a
 * (hash, length) equivalence class: FNV-1a is non-cryptographic 32-bit, so
 * equal-length collisions are craftable (~2^16 candidates) and the length
 * suffix cannot separate them - a victim parse could be served an attacker's
 * cached ruleset (VULN-003, CWE-349 family). PERF-019's collision-prevention
 * claim only holds with this key: distinct texts can never share an entry.
 * Memory cost stays bounded: one string reference per entry under
 * LRU_MAX_ENTRIES, and the parser never caches inputs above MAX_INPUT_SIZE.
 *
 * @param {string} text - キャッシュキーの元となるテキスト
 * @returns {string} - テキストそのもの（等価クラスは文字列一致のみ）
 */
export function generateCacheKey(text: string): string {
  return text;
}

/**
 * 値を deep clone する内部ヘルパー。
 * `structuredClone` が利用可能な環境ではそれを使い、なければ JSON 経由でフォールバックする。
 * キャッシュ値はプレーンオブジェクト/配列のみのため JSON フォールバックでも等価性を保つ。
 */
function deepClone<T>(value: T): T {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * キャッシュから値を取得
 * @param {string} key - キャッシュキー
 * @returns {Object|null} - キャッシュされた値（存在しない場合はnull）
 */
export function getFromCache(key: string): unknown | null {
  if (PARSER_CACHE.has(key)) {
    updateLRUTracker(key);
    const cached = PARSER_CACHE.get(key);
    return deepClone(cached);
  }
  return null;
}

/**
 * キャッシュに値を保存
 * @param {string} key - キャッシュキー
 * @param {Object} value - 保存する値
 */
export function saveToCache(key: string, value: unknown) {
  updateLRUTracker(key);
  PARSER_CACHE.set(key, deepClone(value));
}

/**
 * キャッシュがキーを持っているか判定
 * @param {string} key - キャッシュキー
 * @returns {boolean} - キャッシュにキーが存在するか
 */
export function hasCacheKey(key: string): boolean {
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