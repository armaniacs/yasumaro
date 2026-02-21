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
export declare function checkPrivacy(headers: chrome.webRequest.HttpHeader[]): PrivacyInfo;
//# sourceMappingURL=privacyChecker.d.ts.map