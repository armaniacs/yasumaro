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
