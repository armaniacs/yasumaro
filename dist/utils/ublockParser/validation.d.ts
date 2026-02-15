/**
 * ublockParser/validation.ts
 * uBlock Origin形式フィルターパーサーのバリデーション関数
 *
 * 【機能概要】: 入力値検証とデータ検証を提供
 * 🟢 信頼性レベル: 基本的な型安全パターンおよび plan/UII/10-data-structures.md に記載される制約
 */
/**
 * 【ヘルパー関数】: 文字列型の入力値を検証
 * 【再利用性】: すべてのpublic関数で使用する共通の入力検証
 * 【単一責任】: 文字列型妥当性の確認
 * 🟢 信頼性レベル: 基本的な型安全パターン
 * @param {unknown} value - 検証対象の値
 * @returns {boolean} - 有効な文字列ならtrue
 */
export declare function isValidString(value: unknown): value is string;
/**
 * 【ヘルパー関数】: ドメインの妥当性を検証
 * 【設計方針】: 空ドメインチェックと形式チェックを分離して明確化
 * 【処理効率化】: 短絡評価で不要なチェックをスキップ
 * 【可読性向上】: 各検証が独立したif文で明確
 * 🟢 信頼性レベル: plan/UII/10-data-structures.md に記載されるドメイン制約
 * @param {string} domain - 検証対象のドメイン
 * @returns {boolean} - 有効なドメインならtrue
 */
export declare function validateDomain(domain: string): boolean;
/**
 * 指定された行がuBlock形式のコメント行か判定
 *
 * 【設計方針】: シンプルなプレフィックス判定で確実性を確保
 * 【パフォーマンス】: 正規表現キャッシュによる高速判定
 * 【保守性】: isValidStringの変更があれば一箇所で適用
 * 🟢 信頼性レベル: plan/UII/00-overview.md に記載される基本構文
 * @param {string} line - 判定対象の行
 * @returns {boolean} - コメント行ならtrue
 */
export declare function isCommentLine(line: string): boolean;
/**
 * 指定された行が空行か判定
 *
 * 【設計方針】: trim後の空白行チェックで柔軟な判定
 * 【パフォーマンス】: trimと空文字列比較は最効率的
 * 【保守性]: isValidStringの変更があれば一箇所で適用
 * 🟢 信頼性レベル: 基本的な文字列判定機能
 * @param {string} line - 判定対象の行
 * @returns {boolean} - 空行ならtrue
 */
export declare function isEmptyLine(line: string): boolean;
/**
 * 指定された行が有効なuBlockルールパターンか判定
 *
 * 【設計方針】: `||` プレフィックスと `^` サフィックスの両方をチェック
 * 【パフォーマンス】: 正規表現キャッシュによる高速判定
 * 【保守性】: isValidStringの変更があれば一箇所で適用
 * 🟢 信頼性レベル: plan/UII/00-overview.md に記載される基本構文
 * @param {string} line - 判定対象の行
 * @returns {boolean} - 有効なパターンならtrue
 */
export declare function isValidRulePattern(line: string): boolean;
//# sourceMappingURL=validation.d.ts.map