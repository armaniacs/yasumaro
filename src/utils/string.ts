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
