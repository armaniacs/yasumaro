/**
 * cssUtils.ts
 * 【機能概要】: CSS関連のユーティリティ関数
 * 【設計方針】:
 *   - 複数のモジュールで共有されるCSS関連関数を提供
 *   - DRY原則に従い、重複実装を防ぐ
 */

/**
 * CSSセレクタで使用する文字列をエスケープする
 * CSS.escape()が利用可能な場合はそれを使用し、そうでない場合はフォールバック実装を使用
 * @param str - エスケープ対象の文字列
 * @returns エスケープされた文字列
 */
export function escapeCssSelector(str: string): string {
  // CSS.escape()が利用可能な場合はそれを使用（モダンブラウザ）
  if (typeof CSS !== 'undefined' && CSS.escape) {
    return CSS.escape(str);
  }

  // フォールバック: CSS識別子のルールに従ってエスケープ
  // CSS識別子は [a-zA-Z0-9] と ISO 10646 U+00A0 以上、ハイフン(-)、アンダースコア(_) のみを含むことができる
  // それ以外の文字はバックスラッシュでエスケープする必要がある
  return str.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}
