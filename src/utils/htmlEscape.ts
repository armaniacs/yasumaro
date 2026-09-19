/**
 * Canonical HTML-escape implementation for this project.
 *
 * Use this module for all display-purpose escaping. `src/popup/domUtils.ts`
 * and `src/popup/errorUtils.ts` re-export `escapeHtml` as compatibility
 * shims; Markdown-link handling lives in `markdownSanitizer.ts` (different
 * responsibility, not an escape duplicate).
 */
const HTML_ESCAPE_MAP: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#039;', '/': '&#x2F;'
};
export function escapeHtml(unsafe: unknown): string {
    if (typeof unsafe !== 'string') return '';
    return unsafe.replace(/[&<>"'/]/g, (match) => HTML_ESCAPE_MAP[match] ?? '');
}
