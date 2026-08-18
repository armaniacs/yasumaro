/**
 * appConstants.ts
 * アプリケーション全体で使用する定数定義
 * 📝 コーディング規約遵守: ハードコードされた値の一元管理
 */

// =============================================================================
// 色定数
// =============================================================================

/** ブラウザアクションバッジの背景色 */
export const BADGE_COLORS = {
  /** オレンジ - 通常時/警告 */
  ORANGE: '#F97316',
  /** 緑 - 成功/記録完了 */
  GREEN: '#10B981',
  /** 青 - 処理中/処理済み */
  BLUE: '#3B82F6',
} as const;

/** UI状態表示用の文字色 */
export const STATUS_COLORS = {
  /** 成功時の緑色 */
  SUCCESS: '#2E7D32',
  /** エラー時の赤色 */
  ERROR: '#D32F2F',
  /** 警告時のオレンジ色 */
  WARNING: '#d97706',
} as const;

/** クレンジング統計グラフ用の色（ライトモード） */
export const CLEANSING_GRAPH_COLORS_LIGHT = {
  /** バー背景（紫） */
  BAR: '#6d28d9',
  /** 最終段バー（緑） */
  BAR_FINAL: '#059669',
  /** ラベル文字 */
  LABEL: '#1e293b',
  /** 数値文字 */
  VALUE: '#1e293b',
  /** フッター文字（緑） */
  FOOTER: '#065f46',
} as const;

/** クレンジング統計グラフ用の色（ダークモード） */
export const CLEANSING_GRAPH_COLORS_DARK = {
  /** バー背景（明るい紫） */
  BAR: '#a78bfa',
  /** 最終段バー（明るい緑） */
  BAR_FINAL: '#34d399',
  /** ラベル文字 */
  LABEL: '#e2e8f0',
  /** 数値文字 */
  VALUE: '#cbd5e1',
  /** フッター文字（明るい緑） */
  FOOTER: '#6ee7b7',
} as const;

/** UIコンポーネント用の色 */
export const UI_COLORS = {
  /** ボタン背景（ライトグレー） */
  BUTTON_BG: '#f5f5f5',
  /** ボタン枠線 */
  BUTTON_BORDER: '#ccc',
  /** 接続成功時の緑 */
  CONNECTION_SUCCESS: '#2E7D32',
  /** 接続エラー時の赤 */
  CONNECTION_ERROR: '#D32F2F',
  /** フォールバック警告のオレンジ */
  FALLBACK_WARNING: '#d97706',
  /** CSS変数フォールバック成功色 */
  CSS_SUCCESS_FALLBACK: '#22c55e',
  /** CSS変数フォールバックエラー色 */
  CSS_ERROR_FALLBACK: '#ef4444',
  /** スピナー/ローディング色 */
  SPINNER_COLOR: '#c9a84c' /* 金箔 */,
} as const;

// =============================================================================
// タイムアウト・時間関連定数
// =============================================================================

/** ミリ秒単位の時間定数 */
export const TIMEOUTS = {
  /** Content Script応答タイムアウト: 5秒 */
  CONTENT_SCRIPT: 5000,
  /** AI処理タイムアウト: 30秒 */
  AI_PROCESSING: 30000,
  /** Obsidian書き込みタイムアウト: 30秒 */
  OBSIDIAN_WRITE: 30000,
  /** レートリミットウィンドウ: 1分 */
  RATE_LIMIT_WINDOW: 60 * 1000,
  /** セッションタイムアウト: 24時間 */
  SESSION_TIMEOUT: 24 * 60 * 60 * 1000,
  /** エラーメッセージ表示時間: 5秒 */
  ERROR_MESSAGE_DISPLAY: 5000,
  /** ローカルAIタイムアウト: 2分（120秒） */
  LOCAL_AI: 120000,
  /** Trancoリスト取得タイムアウト: 60秒 */
  TRANCO_FETCH: 60000,
  /** バッチログフラッシュ遅延: 5秒 */
  BATCH_LOG_FLUSH: 5000,
  /** ステータスメッセージ表示時間（成功時）: 3秒 */
  STATUS_MESSAGE_SUCCESS: 3000,
  /** ステータスメッセージ表示時間（エラー時）: 5秒 */
  STATUS_MESSAGE_ERROR: 5000,
} as const;

// =============================================================================
// レートリミット設定
// =============================================================================

/** レートリミット設定 */
export const RATE_LIMITS = {
  /** skipAI 操作の最大回数 */
  SKIP_AI_MAX: 5,
  /** skipAI レートリミットウィンドウ: 1分 */
  SKIP_AI_WINDOW_MS: 60 * 1000,
} as const;
