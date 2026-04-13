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

/** トラストレベル表示用の色 */
export const TRUST_LEVEL_COLORS = {
  /** Trusted - 緑 */
  TRUSTED: '#10b981',
  /** Sensitive - アンバー */
  SENSITIVE: '#f59e0b',
  /** Unverified - グレー */
  UNVERIFIED: '#94a3b8',
  /** Locked - グレー */
  LOCKED: '#6b7280',
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
  SPINNER_COLOR: '#4CAF50',
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
} as const;

// =============================================================================
// サイズ制限定数
// =============================================================================

/** URLやコンテンツのサイズ制限 */
export const SIZE_LIMITS = {
  /** URL最大長: 64KB */
  MAX_URL_LENGTH: 64 * 1024,
  /** 推奨最大コンテンツサイズ: 8KB */
  RECOMMENDED_CONTENT_SIZE: 8000,
  /** 許容最大コンテンツサイズ: 10KB */
  MAX_CONTENT_SIZE: 10000,
} as const;

// =============================================================================
// リトライ設定
// =============================================================================

/** メッセージ送信のリトライ設定 */
export const RETRY_CONFIG = {
  /** 最大リトライ回数 */
  MAX_RETRIES: 3,
  /** 初期待機時間: 2000ms */
  INITIAL_DELAY: 2000,
  /** バックオフ乗数 */
  BACKOFF_MULTIPLIER: 2,
} as const;

// =============================================================================
// デフォルト設定値
// =============================================================================

/** デフォルトの訪問設定 */
export const DEFAULT_VISIT_SETTINGS = {
  /** 最小訪問時間: 5秒 */
  MIN_VISIT_DURATION: 5,
  /** 最小スクロール深度: 50% */
  MIN_SCROLL_DEPTH: 50,
} as const;

/** デフォルトのポート番号 */
export const DEFAULT_PORT = 27123;

// =============================================================================
// エラーコード定数
// =============================================================================

/** ドメインブロックエラーコード */
export const ERROR_CODES = {
  /** ドメインブロック */
  DOMAIN_BLOCKED: 'DOMAIN_BLOCKED',
  /** プライベートページ検出 */
  PRIVATE_PAGE_DETECTED: 'PRIVATE_PAGE_DETECTED',
  /** Content Script利用不可 */
  CONTENT_SCRIPT_NOT_AVAILABLE: 'CONTENT_SCRIPT_NOT_AVAILABLE',
} as const;

// =============================================================================
// 外部URLパターン
// =============================================================================

/** 特殊URLスキーム（記録不可） */
export const NON_RECORDABLE_SCHEMES = [
  'chrome://',
  'chrome-extension://',
  'edge://',
  'about:',
  'file://',
  'javascript:',
  'data:',
  'blob:',
] as const;

// =============================================================================
// セレクタ定数（DOM操作で使用）
// =============================================================================

/** DOM要素セレクタ */
export const DOM_SELECTORS = {
  /** メインステータス表示エリア */
  MAIN_STATUS: '#mainStatus',
  /** 記録ボタン */
  RECORD_BUTTON: '#recordBtn',
  /** ステータスパネル */
  STATUS_PANEL: '#statusPanel',
  /** タグ結果パネル */
  TAG_RESULT_PANEL: '#tagResultPanel',
  /** ローディングスピナー */
  SPINNER: '#loadingSpinner',
} as const;
