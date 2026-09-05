/**
 * protocol.ts
 * メッセージパッシングのプロトコルバージョン定義。
 *
 * 全レイヤー（background / utils / offscreen / popup / dashboard）が参照するため、
 * 特定のレイヤーに属さない中立な位置に置く。
 *
 * background/messageTypes.ts はメッセージの型定義（discriminated union）を担い、
 * 本ファイルはその型に付随するバージョン番号のみを担う。
 *
 * NOTE: src/content/loader.ts は Content Script エントリポイントであり
 * 静的 import ができないため、同じ値をハードコードで複製している。
 * この値を変更する際は loader.ts も併せて更新すること。
 */

/**
 * Current Content-SW message protocol version.
 * Bump this when the message schema changes in a backward-incompatible way.
 */
export const CURRENT_PROTOCOL_VERSION = 1;

/**
 * Graded migration window: how many previous minor generations stay
 * acceptable after CURRENT_PROTOCOL_VERSION moves on.
 *
 * N-1 only (value 1). Rationale: the skew this window covers is a single
 * update cycle (stale content script vs reloaded Service Worker). A wider
 * window would keep untested schema combinations alive longer with no
 * additional coverage; a zero window is the old hard-reject behavior that
 * dropped records during mixed-version periods. This is a temporary
 * migration measure, not permanent multi-generation support — do not widen.
 */
export const PROTOCOL_VERSION_WINDOW_SIZE = 1;
