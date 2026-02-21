export function checkPrivacy(headers) {
    const timestamp = Date.now();
    // 1. Cache-Control チェック（最優先）
    const cacheControl = findHeader(headers, 'cache-control');
    if (cacheControl) {
        const value = cacheControl.value?.toLowerCase() || '';
        if (value.includes('private') || value.includes('no-store') || value.includes('no-cache')) {
            return {
                isPrivate: true,
                reason: 'cache-control',
                timestamp,
                headers: {
                    cacheControl: cacheControl.value,
                    hasCookie: hasHeader(headers, 'set-cookie'),
                    hasAuth: hasHeader(headers, 'authorization')
                }
            };
        }
    }
    // 2. Set-Cookie チェック（準優先）
    if (hasHeader(headers, 'set-cookie')) {
        return {
            isPrivate: true,
            reason: 'set-cookie',
            timestamp,
            headers: {
                cacheControl: cacheControl?.value,
                hasCookie: true,
                hasAuth: hasHeader(headers, 'authorization')
            }
        };
    }
    // 3. Authorization チェック
    if (hasHeader(headers, 'authorization')) {
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