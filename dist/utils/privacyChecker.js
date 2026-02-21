export function checkPrivacy(headers) {
    const timestamp = Date.now();
    // 1. Cache-Control チェック（最優先）
    // 注意: no-cache は「再検証必須」を意味するだけで、プライベートページではない
    // ニュースサイトなど公開ページでも頻繁に使用されるため、プライベート判定から除外
    // private = 共有キャッシュ禁止（CDN/プロキシ経由で他ユーザーに漏れるのを防ぐ）
    // no-store = キャッシュ完全禁止（機密性の高いページ）
    //   ただし、no-store単独では判定せず、Set-Cookieとの組み合わせで判定
    const cacheControl = findHeader(headers, 'cache-control');
    const hasCookie = hasHeader(headers, 'set-cookie');
    const hasAuth = hasHeader(headers, 'authorization');
    if (cacheControl) {
        const value = cacheControl.value?.toLowerCase() || '';
        // private ディレクティブは単独でプライベート判定
        if (value.includes('private')) {
            return {
                isPrivate: true,
                reason: 'cache-control',
                timestamp,
                headers: {
                    cacheControl: cacheControl.value,
                    hasCookie,
                    hasAuth
                }
            };
        }
        // no-store は Set-Cookie と組み合わせた場合のみプライベート判定
        if (value.includes('no-store') && hasCookie) {
            return {
                isPrivate: true,
                reason: 'cache-control',
                timestamp,
                headers: {
                    cacheControl: cacheControl.value,
                    hasCookie,
                    hasAuth
                }
            };
        }
    }
    // 2. Set-Cookie チェック（準優先）
    if (hasCookie) {
        return {
            isPrivate: true,
            reason: 'set-cookie',
            timestamp,
            headers: {
                cacheControl: cacheControl?.value,
                hasCookie: true,
                hasAuth
            }
        };
    }
    // 3. Authorization チェック
    if (hasAuth) {
        return {
            isPrivate: true,
            reason: 'authorization',
            timestamp,
            headers: {
                cacheControl: cacheControl?.value,
                hasCookie: false,
                hasAuth: true
            }
        };
    }
    // 4. いずれも該当しない
    return {
        isPrivate: false,
        timestamp,
        headers: {
            cacheControl: cacheControl?.value,
            hasCookie: false,
            hasAuth: false
        }
    };
}
function findHeader(headers, name) {
    return headers.find(h => h.name?.toLowerCase() === name.toLowerCase());
}
function hasHeader(headers, name) {
    return findHeader(headers, name) !== undefined;
}
//# sourceMappingURL=privacyChecker.js.map