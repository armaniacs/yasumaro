export interface StatusInfo {
    domainFilter: {
        allowed: boolean;
        mode: 'disabled' | 'whitelist' | 'blacklist';
        matched: boolean;
        matchedPattern?: string;
    };
    privacy: {
        isPrivate: boolean;
        reason?: 'cache-control' | 'set-cookie' | 'authorization';
        hasCache: boolean;
        piiRisk?: 'high' | 'medium' | 'low';
    };
    cache: {
        cacheControl?: string;
        hasCookie: boolean;
        hasAuth: boolean;
        hasCache: boolean;
    };
    lastSaved: {
        timestamp?: number;
        timeAgo?: string;
        formatted?: string;
        exists: boolean;
    };
}
interface TimeFormat {
    timeAgo: string;
    formatted: string;
}
export declare function formatTimeAgo(timestamp: number): TimeFormat;
export declare function checkPageStatus(url: string): Promise<StatusInfo | null>;
export {};
//# sourceMappingURL=statusChecker.d.ts.map