/**
 * lateContentDomReader.ts
 *
 * Single DOM-read seam for the SPA late-content re-scan (PBI 2026-10-22-06,
 * slice 2). Split out of lateContentRescan.ts so the verdict stays a pure,
 * DOM-free module: unit tests pin the threshold table without a document,
 * and the kernel injects a fake reader instead of touching the live page.
 *
 * Fail-closed by contract: a missing body, a hostile DOM, or no document
 * at all reads as 0, which can never satisfy the re-arm threshold.
 */

export function readVisibleChars(): number {
  try {
    if (typeof document === 'undefined') return 0;
    const text = document.body?.innerText ?? '';
    return typeof text === 'string' ? text.length : 0;
  } catch {
    return 0;
  }
}
