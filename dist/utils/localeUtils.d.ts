/**
 * localeUtils.ts
 *
 * ロケール関連のヘルパー関数を提供します。
 * ユーザーの言語設定を動的に取得し、i18n対応のインフラを提供します。
 */
/**
 * ユーザーロケールを取得します
 *
 * Chrome Extension環境内では chrome.i18n.getUILanguage() を使用します。
 * テスト環境などChrome APIが利用できない場合はフォールバックを返します。
 *
 * @returns {string} ユーザーロケールコード (例: 'ja', 'ja-JP', 'en-US', 'ar')
 */
export declare function getUserLocale(): string;
/**
 * RTL（右から左へ書く）言語かどうかを判定します
 *
 * @param {string} locale - 判定するロケールコード（省略時は現在のユーザーロケール）
 * @returns {boolean} RTL言語の場合はtrue、それ以外はfalse
 */
export declare function isRTL(locale?: string): boolean;
/**
 * 日付をユーザーロケールでフォーマットします
 *
 * @param {Date|string|number} date - フォーマットする日付（省略時は現在日時）
 * @param {Intl.DateTimeFormatOptions} options - Intl.DateTimeFormatのオプション（省略時はデフォルト）
 * @returns {string} フォーマットされた日時文字列
 */
export declare function formatDate(date?: Date | string | number, options?: Intl.DateTimeFormatOptions): string;
/**
 * 日時をユーザーロケールでフォーマットします（時間を含む）
 *
 * @param {Date|string|number} date - フォーマットする日付（省略時は現在日時）
 * @param {Intl.DateTimeFormatOptions} options - Intl.DateTimeFormatのオプション（省略時はデフォルト）
 * @returns {string} フォーマットされた日時文字列
 */
export declare function formatDateTime(date?: Date | string | number, options?: Intl.DateTimeFormatOptions): string;
/**
 * 日付パス用の区切り文字を取得します
 *
 * ロケールに応じた区切り文字を返します。
 * 将来的にロケールごとのカスタマイズが可能です。
 *
 * @returns {string} 区切り文字（デフォルト: '-'）
 */
export declare function getDateSeparator(): string;
//# sourceMappingURL=localeUtils.d.ts.map