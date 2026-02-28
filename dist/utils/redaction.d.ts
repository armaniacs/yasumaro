/**
 * redaction.ts
 * コンソールログの機密情報削除モジュール
 * APIキー、パスワードなどの機密情報をログ出力から保護
 */
/**
 * 再帰的に機密情報を削除する
 */
export declare function redactSensitiveData(data: unknown, depth?: number): unknown;
/**
 * セキュアなエラーログを出力する
 */
export declare function consoleSecureError(message: string, data?: unknown): void;
//# sourceMappingURL=redaction.d.ts.map