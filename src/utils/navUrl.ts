/**
 * navUrl.ts
 * URL normalization for the navigation trail (PBI 2026-09-26-03).
 *
 * Lives in `src/utils/` because both the background recorder and the
 * dashboard (PBI 2026-09-26-04) need it, and the layer rules forbid a
 * background ↔ dashboard import.
 *
 * WHY only http(s) survives: `nav_source_url` is recorded from tab activity, and
 * a `javascript:` or `file:` value would later be rendered back into the
 * dashboard. Rejecting here means the stored column can never hold a scheme
 * the UI would have to special-case.
 *
 * WHY the fragment is dropped: `#section` distinguishes anchors inside one
 * document, not one page. Keeping it would make a pure in-page anchor jump look
 * like a navigation and split a research session in two.
 */

export function normalizeNavUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}
