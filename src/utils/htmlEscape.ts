const HTML_ESCAPE_MAP: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#039;', '/': '&#x2F;'
};
export function escapeHtml(unsafe: unknown): string {
    if (typeof unsafe !== 'string') return '';
    return unsafe.replace(/[&<>"'/]/g, (match) => HTML_ESCAPE_MAP[match] ?? '');
}
