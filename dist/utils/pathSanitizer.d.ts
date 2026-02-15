/**
 * pathSanitizer.ts
 * URLパスのセキュリティサニタイズ関数
 * 問題点2: URLパスサニタイズ不足の修正
 */
/**
 * パスセグメントをサニタイズする
 * @param {string} pathSegment - サニタイズ対象のパス
 * @returns {string} サニタイズされた安全なパス
 * @throws {Error} サニタイズできない危険な入力の場合
 */
export declare function sanitizePathSegment(pathSegment: string): string;
/**
 * URL用のパスを生成する前にサニタイズする
 * buildDailyNotePathと組み合わせて使用するためのラッパー関数
 * @param {string} pathRaw - ユーザー入力のパス
 * @returns {string} サニタイズされたパス
 */
export declare function sanitizePathForUrl(pathRaw: string): string;
/**
 * パスを安全なURLパスに変換する
 * 与えられたパスをURLクエリパラメータとして使用する場合にエンコードを行う
 * @param {string} path - エンコード対象のパス
 * @returns {string} URLセーフなエンコード済みパス
 */
export declare function encodePathForUrl(path: string): string;
//# sourceMappingURL=pathSanitizer.d.ts.map