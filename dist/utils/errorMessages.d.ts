/**
 * errorMessages.ts
 * エラーメッセージの管理と分離
 *
 * 【目的】:
 * ユーザー向けエラーメッセージとログ用エラーメッセージを分離し、
 * 技術情報の漏洩を防ぐ
 *
 * 【Code Review P2】: エラーメッセージの技術情報漏洩対策
 */
/**
 * エラータイプの定義
 */
export declare const ErrorType: {
    readonly NETWORK: "NETWORK";
    readonly AUTH: "AUTH";
    readonly VALIDATION: "VALIDATION";
    readonly NOT_FOUND: "NOT_FOUND";
    readonly RATE_LIMIT: "RATE_LIMIT";
    readonly SERVER: "SERVER";
    readonly UNKNOWN: "UNKNOWN";
};
export type ErrorTypeValues = typeof ErrorType[keyof typeof ErrorType];
/**
 * エラーを分類する
 * @param {Error} error - 発生したエラー
 * @returns {ErrorTypeValues} エラータイプ
 */
export declare function classifyError(error: any): ErrorTypeValues;
/**
 * ユーザー向けエラーメッセージを取得する
 * @param {Error} error - 発生したエラー
 * @returns {string} ユーザー向けメッセージ
 */
export declare function getUserMessage(error: any): string;
export interface ErrorResponse {
    success: boolean;
    error: string;
    errorType: ErrorTypeValues;
}
/**
 * エラーレスポンスオブジェクトを作成する
 * @param {Error} error - 発生したエラー
 * @param {Object} context - コンテキスト情報（ログ用）
 * @returns {ErrorResponse} レスポンスオブジェクト
 */
export declare function createErrorResponse(error: any, context?: Record<string, any>): ErrorResponse;
/**
 * 既知のエラーメッセージをユーザー向けに変換する
 * @param {string} errorMessage - 元のエラーメッセージ
 * @returns {string} ユーザー向けメッセージ
 */
export declare function convertKnownErrorMessage(errorMessage: string): string;
//# sourceMappingURL=errorMessages.d.ts.map