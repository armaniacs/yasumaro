/**
 * privacyStatusCodes.ts
 *
 * プライバシー検出のステータスコード定義。
 *
 * コード体系: PSH-XXXX (Privacy Status History - 歴史的略称を維持)
 *   1xxx = Cache-Control ヘッダー系
 *   2xxx = Cookie / セッション系
 *   3xxx = 認証系
 *   9xxx = その他 / 不明
 */
export declare const PrivacyStatusCode: {
    /** Cache-Control: private または no-store + Set-Cookie が検出された */
    readonly CACHE_CONTROL: "PSH-1001";
    /** Set-Cookie ヘッダーが検出された（セッションCookie）*/
    readonly SET_COOKIE: "PSH-2001";
    /** Authorization ヘッダーが検出された */
    readonly AUTHORIZATION: "PSH-3001";
    /** 判定理由が不明 */
    readonly UNKNOWN: "PSH-9001";
};
export type PrivacyStatusCodeValue = typeof PrivacyStatusCode[keyof typeof PrivacyStatusCode];
/**
 * recordingLogic が返す reason 文字列から PrivacyStatusCode へのマッピング
 */
export declare function reasonToStatusCode(reason: string | undefined): PrivacyStatusCodeValue;
/**
 * ステータスコードに対応する i18n キーを返す
 */
export declare function statusCodeToMessageKey(code: PrivacyStatusCodeValue): string;
//# sourceMappingURL=privacyStatusCodes.d.ts.map