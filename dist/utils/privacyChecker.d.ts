export interface PrivacyInfo {
    isPrivate: boolean;
    reason?: 'cache-control' | 'set-cookie' | 'authorization';
    timestamp: number;
    headers?: {
        cacheControl?: string;
        hasCookie: boolean;
        hasAuth: boolean;
    };
}
/**
 * プライバシー判定ロジック
 *
 * 詳細な判定基準と技術的根拠については以下を参照:
 * docs/ADR/2026-02-21-privacy-detection-logic-refinement.md
 */
export declare function checkPrivacy(headers: chrome.webRequest.HttpHeader[]): PrivacyInfo;
//# sourceMappingURL=privacyChecker.d.ts.map