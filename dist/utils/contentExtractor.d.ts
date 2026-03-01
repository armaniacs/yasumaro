/**
 * contentExtractor.ts
 * 【機能概要】: Webページのメインコンテンツを抽出し、ノイズ（ナビゲーション、ヘッダー等）を除去する
 * 【設計方針】:
 *   - 外部ライブラリ不使用（バンドルサイズ抑止）
 *   - Readabilityアルゴリズムの簡易実装
 *   - ベストエフォートで抽出し、失敗時はフォールバック
 *   - 最大文字数制限の維持
 * 🟢
 */
/**
 * 要素が除外対象かどうかを判定
 * @internal テスト用にエクスポート
 */
export declare function isExcludedElement(element: Element): boolean;
/**
 * 要素のテキストスコアを計算
 * テキストの多さ、段落の数、リンク密度などに基づいてスコアを計算
 */
export declare function calculateTextScore(element: Element): number;
/**
 * ページのメインコンテンツを抽出する
 * 【機能概要】: メインコンテンツ（記事、本文等）をテキストとして抽出
 * 【処理内容】:
 *   1. article/mainタグを優先的に探索
 *   2. 見出し、段落の多い要素を選択
 *   3. ナビゲーション、ヘッダー等を除外
 *   4. 最大文字数で切り詰め
 * 【フォールバック】: メインコンテンツが見つからない場合は body.innerText を使用
 * 【サイズ制限】: maxChars で指定された最大文字数（デフォルト: 10000）
 * 🟢
 * @param maxChars - 最大文字数（デフォルト: 10000）
 * @returns 抽出されたテキスト（空白正規化済み、最大文字数制限適用）
 */
export declare function extractMainContent(maxChars?: number): string;
//# sourceMappingURL=contentExtractor.d.ts.map