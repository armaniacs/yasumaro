/**
 * fieldValidation.ts
 * フィールドバリデーションモジュール
 * 設定フォームの各入力フィールドのバリデーションを行う
 */
export type ErrorPair = [HTMLInputElement, string];
/**
 * フィールドバリデーションの結果を表示
 * @param {HTMLInputElement} input - 入力要素
 * @param {string} errorId - エラーメッセージ表示要素のID
 * @param {string} message - エラーメッセージ
 */
export declare function setFieldError(input: HTMLInputElement, errorId: string, message: string): void;
/**
 * フィールドのエラー状態をクリア
 * @param {HTMLInputElement} input - 入力要素
 * @param {string} errorId - エラーメッセージ表示要素のID
 */
export declare function clearFieldError(input: HTMLInputElement, errorId: string): void;
/**
 * すべてのフィールドエラーをクリア
 * @param {Array.<[HTMLInputElement, string]>} pairs - [input, errorId]の配列
 */
export declare function clearAllFieldErrors(pairs: ErrorPair[]): void;
/**
 * プロトコルフィールドのバリデーション
 * @param {HTMLInputElement} input - 入力要素
 * @returns {boolean} 有効な場合はtrue
 */
export declare function validateProtocol(input: HTMLInputElement): boolean;
/**
 * ポート番号フィールドのバリデーション
 * @param {HTMLInputElement} input - 入力要素
 * @returns {boolean} 有効な場合はtrue
 */
export declare function validatePort(input: HTMLInputElement): boolean;
/**
 * 最小訪問時間フィールドのバリデーション
 * @param {HTMLInputElement} input - 入力要素
 * @returns {boolean} 有効な場合はtrue
 */
export declare function validateMinVisitDuration(input: HTMLInputElement): boolean;
/**
 * 最小スクロール深度フィールドのバリデーション
 * @param {HTMLInputElement} input - 入力要素
 * @returns {boolean} 有効な場合はtrue
 */
export declare function validateMinScrollDepth(input: HTMLInputElement): boolean;
/**
 * BaseUrlフィールドのバリデーション
 * @param {HTMLInputElement} input - 入力要素
 * @returns {Promise<boolean>} 有効な場合はtrue
 */
export declare function validateBaseUrl(input: HTMLInputElement): Promise<boolean>;
/**
 * プロトコルフィールドのバリデーションイベントリスナーを設定
 * @param {HTMLInputElement} input - 入力要素
 * @returns {() => void} リスナー削除関数
 */
export declare function setupProtocolValidation(input: HTMLInputElement): () => void;
/**
 * ポート番号フィールドのバリデーションイベントリスナーを設定
 * @param {HTMLInputElement} input - 入力要素
 * @returns {() => void} リスナー削除関数
 */
export declare function setupPortValidation(input: HTMLInputElement): () => void;
/**
 * 最小訪問時間フィールドのバリデーションイベントリスナーを設定
 * @param {HTMLInputElement} input - 入力要素
 * @returns {() => void} リスナー削除関数
 */
export declare function setupMinVisitDurationValidation(input: HTMLInputElement): () => void;
/**
 * 最小スクロール深度フィールドのバリデーションイベントリスナーを設定
 * @param {HTMLInputElement} input - 入力要素
 * @returns {() => void} リスナー削除関数
 */
export declare function setupMinScrollDepthValidation(input: HTMLInputElement): () => void;
/**
 * 主要フィールドのバリデーションイベントリスナーを一括設定
 * @param {HTMLInputElement} protocolInput - プロトコル入力
 * @param {HTMLInputElement} portInput - ポート入力
 * @param {HTMLInputElement} minVisitDurationInput - 最小訪問時間入力
 * @param {HTMLInputElement} minScrollDepthInput - 最小スクロール深度入力
 * @returns {Array.<() => void>} リスナー削除関数の配列
 */
export declare function setupAllFieldValidations(protocolInput: HTMLInputElement, portInput: HTMLInputElement, minVisitDurationInput: HTMLInputElement, minScrollDepthInput: HTMLInputElement): (() => void)[];
/**
 * すべてのフィールドバリデーションを実行
 * @param {HTMLInputElement} protocolInput - プロトコル入力
 * @param {HTMLInputElement} portInput - ポート入力
 * @param {HTMLInputElement} minVisitDurationInput - 最小訪問時間入力
 * @param {HTMLInputElement} minScrollDepthInput - 最小スクロール深度入力
 * @returns {boolean} すべて有効な場合はtrue
 */
export declare function validateAllFields(protocolInput: HTMLInputElement, portInput: HTMLInputElement, minVisitDurationInput: HTMLInputElement, minScrollDepthInput: HTMLInputElement): boolean;
//# sourceMappingURL=fieldValidation.d.ts.map