/**
 * wildcardToRegex.ts
 * Shared wildcard-pattern → RegExp conversion with a ReDoS guard.
 * Canonical implementation for all domain-matching call sites.
 */

/**
 * Upper bound on `*` occurrences in a single pattern. Patterns above this are
 * rejected (return `null`) as a ReDoS guard — each `*` becomes `.*`, and many
 * `.*` against a long string backtrack catastrophically. Callers that validate
 * patterns before storage should reject counts above this too.
 */
export const MAX_WILDCARDS_PER_PATTERN = 5;

/**
 * Convert a wildcard pattern to a case-insensitive anchored RegExp.
 * @param pattern - Pattern where `*` is a wildcard. `null` is returned for
 *   empty patterns or patterns exceeding MAX_WILDCARDS_PER_PATTERN (ReDoS guard).
 */
export function wildcardToRegex(pattern: string): RegExp | null {
    if (!pattern || !pattern.includes('*')) {
        return pattern ? new RegExp(`^${escapeRegex(pattern)}$`, 'i') : null;
    }
    const wildcardCount = (pattern.match(/\*/g) || []).length;
    if (wildcardCount > MAX_WILDCARDS_PER_PATTERN) return null;
    const escaped = escapeRegex(pattern);
    const regexPattern = escaped.replace(/\\\*/g, '.*');
    return new RegExp(`^${regexPattern}$`, 'i');
}

/**
 * Escape regex special characters so a string is matched literally.
 */
function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Canonical domain-pattern matcher (single shared path, PBI-18).
 * All domain-matching call sites (background domainUtils, content-script
 * urlSkipper, storage domainFilterCache, DomainFilter seam, popup
 * statusChecker) delegate here so wildcard semantics cannot drift.
 * ReDoS guard is inherited from wildcardToRegex: over-limit patterns
 * return null there and are treated as non-match (never throw).
 */
export function matchesDomainPattern(domain: string, pattern: string): boolean {
    if (!pattern.includes('*')) {
        return domain.toLowerCase() === pattern.toLowerCase();
    }
    const regex = wildcardToRegex(pattern);
    if (!regex) return false;
    return regex.test(domain);
}

/**
 * Canonical domain-list check (single shared path, PBI-18).
 */
export function isDomainInList(domain: string, domainList: string[] | undefined): boolean {
    if (!domainList || domainList.length === 0) {
        return false;
    }
    return domainList.some((pattern) => matchesDomainPattern(domain, pattern));
}

/**
 * Canonical hostname extraction (single shared path, PBI-18).
 * Strips the www. prefix; returns null for unparseable URLs.
 */
export function extractHostname(url: string): string | null {
    try {
        const urlObj = new URL(url);
        let hostname = urlObj.hostname;
        if (hostname.startsWith('www.')) {
            hostname = hostname.substring(4);
        }
        return hostname;
    } catch {
        return null;
    }
}
