/**
 * Canonical HTML-escape implementation for this project.
 *
 * Use this module for all display-purpose escaping. `src/popup/domUtils.ts`
 * and `src/popup/errorUtils.ts` re-export `escapeHtml` as compatibility
 * shims; Markdown-link handling lives in `markdownSanitizer.ts` (different
 * responsibility, not an escape duplicate).
 *
 * Input contract (PBI 2026-11-08-17): the parameter is typed
 * `string | null | undefined`. Absent values (null/undefined) escape to ''
 * by design — callers threading optional text stay terse. Any other
 * non-string (numbers, objects, booleans, symbols) throws a TypeError
 * instead of blanking to '': silently rendering '' for a mistyped value
 * hid caller bugs (e.g. a numeric id rendering as an empty attribute).
 * A `as any` cast at the call site still compiles, but the throw makes the
 * misuse loud at runtime instead of invisible in the DOM.
 *
 * 注意(意図的破壊的変更): 非string非nullish は TypeError (旧 '' 黙殺) — 数値等を渡す呼び出しは修正が必要。
 */
const HTML_ESCAPE_MAP: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#039;', '/': '&#x2F;'
};
export function escapeHtml(unsafe: string | null | undefined): string {
    if (unsafe === null || unsafe === undefined) return '';
    if (typeof unsafe !== 'string') {
        throw new TypeError(`escapeHtml expects a string, null, or undefined (got ${typeof unsafe})`);
    }
    return unsafe.replace(/[&<>"'/]/g, (match) => HTML_ESCAPE_MAP[match] ?? '');
}
