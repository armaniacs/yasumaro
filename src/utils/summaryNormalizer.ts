/**
 * summaryNormalizer.ts
 * 【機能概要】: 日本語AI要約の文末を「である調」に正規化するポストプロセス
 * 【設計方針】:
 *   - 日本語テキストのみ変換（英語は無変換）
 *   - ですます調 → である調の文字列置換
 *   - 副作用を最小化するため、単純な正規表現置換のみ使用
 *   - 外部ライブラリ不使用
 */

/**
 * テキストに日本語（ひらがな・カタカナ・漢字）が含まれるか判定する
 */
function isJapanese(text: string): boolean {
  return /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]/.test(text);
}

/**
 * 日本語AI要約の文末をですます調からである調に正規化する。
 * 英語テキストや空文字列はそのまま返す。
 *
 * @param summary - 正規化対象の要約テキスト
 * @returns 正規化後のテキスト
 */
export function normalizeJapaneseSummary(summary: string): string {
  if (!summary.trim()) return summary;
  if (!isJapanese(summary)) return summary;

return summary
    .replace(/ておりました。/g, 'ておる。')
    .replace(/ておりました$/g, 'ておる')
    .replace(/ていました。/g, 'ていた。')
    .replace(/ていました$/g, 'ていた')
    .replace(/んでした。/g, 'んでいた。')
    .replace(/んでした$/g, 'んでいた')
    .replace(/んでいました。/g, 'んでとしていた。')
    .replace(/んでいました$/g, 'んでとしていた')
    .replace(/んでいます。/g, 'んでいる。')
    .replace(/んでいます$/g, 'んでいる')
    .replace(/てみます。/g, 'てみる。')
    .replace(/てみます$/g, 'てみる')
    .replace(/てしまいます。/g, 'てしまう。')
    .replace(/てしまいます$/g, 'てしまう')
    .replace(/て来过ます。/g, 'て来る。')
    .replace(/て来过ます$/g, 'て来る')
    .replace(/でした。/g, 'だった。')
    .replace(/でした$/g, 'だった')
    .replace(/でしょう。/g, 'だろう。')
    .replace(/でしょう$/g, 'だろう')
    .replace(/です。/g, 'だ。')
    .replace(/です$/g, 'だ');
}
