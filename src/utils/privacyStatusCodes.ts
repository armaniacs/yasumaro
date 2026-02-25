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

export const PrivacyStatusCode = {
    // 1xxx: Cache-Control ヘッダー系
    /** Cache-Control: private または no-store + Set-Cookie が検出された */
    CACHE_CONTROL: 'PSH-1001',

    // 2xxx: Cookie / セッション系
    /** Set-Cookie ヘッダーが検出された（セッションCookie）*/
    SET_COOKIE: 'PSH-2001',

    // 3xxx: 認証系
    /** Authorization ヘッダーが検出された */
    AUTHORIZATION: 'PSH-3001',

    // 9xxx: その他
    /** 判定理由が不明 */
    UNKNOWN: 'PSH-9001',
} as const;

export type PrivacyStatusCodeValue = typeof PrivacyStatusCode[keyof typeof PrivacyStatusCode];

/**
 * recordingLogic が返す reason 文字列から PrivacyStatusCode へのマッピング
 */
export function reasonToStatusCode(reason: string | undefined): PrivacyStatusCodeValue {
    switch (reason) {
        case 'cache-control':
            return PrivacyStatusCode.CACHE_CONTROL;
        case 'set-cookie':
            return PrivacyStatusCode.SET_COOKIE;
        case 'authorization':
            return PrivacyStatusCode.AUTHORIZATION;
        default:
            return PrivacyStatusCode.UNKNOWN;
    }
}

/**
 * ステータスコードに対応する i18n キーを返す
 */
export function statusCodeToMessageKey(code: PrivacyStatusCodeValue): string {
    const map: Record<PrivacyStatusCodeValue, string> = {
        [PrivacyStatusCode.CACHE_CONTROL]:  'privacyStatus_cacheControl',
        [PrivacyStatusCode.SET_COOKIE]:     'privacyStatus_setCookie',
        [PrivacyStatusCode.AUTHORIZATION]:  'privacyStatus_authorization',
        [PrivacyStatusCode.UNKNOWN]:        'privacyStatus_unknown',
    };
    return map[code] ?? 'privacyStatus_unknown';
}
