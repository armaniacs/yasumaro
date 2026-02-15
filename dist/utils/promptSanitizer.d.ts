/**
 * promptSanitizer.ts
 * AIプロンプトへのコンテンツ注入対策
 * Webページから抽出されたコンテンツをサニタイズして
 * AIプロンプトインジェクションを防止する
 */
/**
 * プロンプトインジェクションの危険度レベル
 */
export declare const DangerLevel: {
    readonly SAFE: "safe";
    readonly LOW: "low";
    readonly MEDIUM: "medium";
    readonly HIGH: "high";
};
export type DangerLevelValues = typeof DangerLevel[keyof typeof DangerLevel];
/**
 * プロンプトサニタイザの結果
 * @typedef {Object} SanitizeResult
 * @property {string} sanitized - サニタイズされたコンテンツ
 * @property {DangerLevelValues} dangerLevel - 危険度レベル
 * @property {string[]} warnings - 検出された警告メッセージ
 */
export interface SanitizeResult {
    sanitized: string;
    dangerLevel: DangerLevelValues;
    warnings: string[];
}
/**
 * コンテンツをサニタイズしてプロンプトインジェクションを防止する
 * @param {string} content - サニタイズするコンテンツ
 * @returns {SanitizeResult} サニタイズ結果
 */
export declare function sanitizePromptContent(content: string): SanitizeResult;
/**
 * コンテンツの危険度を確認する
 * @param {string} content - 確認するコンテンツ
 * @returns {DangerLevelValues} 危険度レベル
 */
export declare function checkContentDangerLevel(content: string): DangerLevelValues;
/**
 * 検出された警告をログ用にフォーマット
 * @param {string[]} warnings - 警告メッセージ配列
 * @returns {string} フォーマットされたメッセージ
 */
export declare function formatWarnings(warnings: string[]): string;
//# sourceMappingURL=promptSanitizer.d.ts.map