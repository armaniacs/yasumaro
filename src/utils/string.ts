/**
 * string.ts
 * 汎用文字列ユーティリティ。DOM/chrome API に依存しない純粋関数のみを置く。
 */

/**
 * 正規表現特殊文字をエスケープする
 */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `parseInt` with NaN fallback. Invalid input yields `fallback`
 * instead of NaN propagating into settings/storage.
 * (Moved from aiSummaryCleansingSettingsV2.ts during DRY 02.)
 */
export function parseIntOr(value: string | null | undefined, fallback: number): number {
  const parsed = parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}
