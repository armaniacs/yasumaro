/**
 * errorUtils.ts
 * エラーハンドリング共通モジュール
 */
/**
 * エラーメッセージ定数（Problem #5: キャッシュ追加でパフォーマンス改善）
 */
export declare const ErrorMessages: {
    /**
     * コネクションエラー（Content Scriptとの通信失敗）
     */
    readonly CONNECTION_ERROR: string;
    /**
     * ドメインブロックエラー
     */
    readonly DOMAIN_BLOCKED: string;
    /**
     * 一般エラープレフィックス
     */
    readonly ERROR_PREFIX: string;
    /**
     * 成功メッセージ
     */
    readonly SUCCESS: string;
    /**
     * キャンセルメッセージ
     */
    readonly CANCELLED: string;
    /**
     * 不明なエラー
     */
    readonly UNKNOWN_ERROR: string;
};
/**
 * エラータイプ
 */
export declare const ErrorType: {
    /** Content Scriptとの通信エラー */
    readonly CONNECTION: "CONNECTION";
    /** ドメインブロックエラー */
    readonly DOMAIN_BLOCKED: "DOMAIN_BLOCKED";
    /** 一般エラー */
    readonly GENERAL: "GENERAL";
};
export type ErrorTypeValues = typeof ErrorType[keyof typeof ErrorType];
/**
 * HTMLエンティティエスケープ関数
 * XSS攻撃を防ぐために、HTML文字をエンティティに変換する
 * @param {string} unsafe - エスケープ対象の文字列
 * @returns {string} HTML エンティティにエスケープされた安全な文字列
 * 問題点3: HTMLエンティティエスケープの追加
 */
export declare function escapeHtml(unsafe: unknown): string;
/**
 * エラーがコネクションエラーかどうかを判定
 * @param {Error} error - エラーオブジェクト
 * @returns {boolean} コネクションエラーの場合true
 */
export declare function isConnectionError(error: any): boolean;
/**
 * ドメインブロックエラー判定用の定数コード
 * background workerとpopup間で共有されるエラー識別子
 */
export declare const DOMAIN_BLOCKED_ERROR_CODE = "DOMAIN_BLOCKED";
/**
 * エラーがドメインブロックエラーかどうかを判定
 * @param {Error} error - エラーオブジェクト
 * @returns {boolean} ドメインブロックエラーの場合true
 */
export declare function isDomainBlockedError(error: any): boolean;
/**
 * エラータイプを判定
 * @param {Error} error - エラーオブジェクト
 * @returns {ErrorType} エラータイプ
 */
export declare function getErrorType(error: any): ErrorTypeValues;
/**
 * エラーメッセージから内部情報を削除する
 * ユーザーに表示する前に内部実装の詳細やデバッグ情報を削除
 * @param {string} message - エラーメッセージ
 * @returns {string} ユーザー向けエラーメッセージ
 * Problem #4: INTERNAL_KEYWORDSをモジュールスコープ定数に移動してパフォーマンス改善
 */
export declare function sanitizeErrorMessage(message: string): string;
/**
 * ユーザー向けエラーメッセージを取得
 * @param {Error} error - エラーオブジェクト
 * @returns {string} ユーザー向けエラーメッセージ
 */
export declare function getUserErrorMessage(error: any): string;
/**
 * エラーをステータス要素に表示
 * @param {HTMLElement} statusElement - ステータス要素
 * @param {Error} error - エラーオブジェクト
 * @param {Function} onForceRecord - 強制記録コールバック
 */
export declare function showError(statusElement: HTMLElement, error: any, onForceRecord?: (() => void) | null): void;
/**
 * 成功メッセージを表示
 * @param {HTMLElement} statusElement - ステータス要素
 * @param {string} message - 成功メッセージ（オプション）
 */
export declare function showSuccess(statusElement: HTMLElement, message?: string): void;
interface ErrorHandlers {
    onConnectionError?: (error: any) => void;
    onDomainBlocked?: (error: any) => void;
    onGeneralError?: (error: any) => void;
}
/**
 * エラーハンドリング共通処理
 * @param {Error} error - エラーオブジェクト
 * @param {Object} handlers - ハンドラー設定
 * @param {Function} handlers.onConnectionError - コネクションエラーハンドラー
 * @param {Function} handlers.onDomainBlocked - ドメインブロックエラーハンドラー
 * @param {Function} handlers.onGeneralError - 一般エラーハンドラー
 */
export declare function handleError(error: any, handlers: ErrorHandlers): void;
/**
 * 処理時間をフォーマット
 * @param ms - ミリ秒単位の時間
 * @returns フォーマットされた文字列 (例: "850ms" or "1.2秒")
 * @example
 * formatDuration(500)   // => "500ms"
 * formatDuration(1234)  // => "1.2秒"
 * formatDuration(-100)  // => "0ms"
 */
export declare function formatDuration(ms: number): string;
/**
 * 処理時間付き成功メッセージを生成
 * @param totalDuration - 全体処理時間 (ms)
 * @param aiDuration - AI処理時間 (ms, optional)
 * @returns フォーマットされたメッセージ
 */
export declare function formatSuccessMessage(totalDuration: number, aiDuration?: number): string;
export {};
//# sourceMappingURL=errorUtils.d.ts.map