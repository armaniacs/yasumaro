/**
 * reasonLabel.ts — single owner of the privacy-reason → display-label policy
 * (PBI 2026-09-12-31).
 *
 * Three surfaces (SW recordingHandlers, content visitReporter, popup
 * recordSession) used to hand-spell `privatePageReason_${reason.replace('-','')}`
 * — a first-occurrence-only replace that silently broke for multi-hyphen
 * reasons, and two i18n families (`privatePageReason_*` fallback vs
 * `privacyStatus_*` canonical). This table unifies both: the canonical
 * `privacyStatus_*` key resolves first, the legacy `privatePageReason_*`
 * key is the documented fallback, and hyphens are replaced globally.
 */
import { reasonToStatusCode, statusCodeToMessageKey } from './privacyStatusCodes.js';

/** Canonical reason values the pipeline can emit. */
export type PrivacyReason = 'cache-control' | 'set-cookie' | 'authorization' | 'unknown';

/**
 * Resolve the i18n message key for a privacy reason.
 *
 * Order: canonical `privacyStatus_*` (from the status-code table) first,
 * legacy `privatePageReason_*` as the fallback — both key families exist in
 * the locales and callers may need either.
 */
export function reasonToMessageKeys(reason: string | undefined): { canonical: string; legacy: string } {
  const code = reasonToStatusCode(reason);
  const canonical = statusCodeToMessageKey(code);
  const legacy = `privatePageReason_${(reason || 'cache-control').replaceAll('-', '')}`;
  return { canonical, legacy };
}

/**
 * Resolve a display label for a reason via an injected getMessage.
 *
 * Tries the canonical key, then the legacy key, then the raw reason string —
 * one policy instead of three hand-rolled spellings.
 */
export function resolveReasonLabel(
  reason: string | undefined,
  getMessage: (key: string, substitutions?: string | string[]) => string,
): string {
  const { canonical, legacy } = reasonToMessageKeys(reason);
  return getMessage(canonical) || getMessage(legacy) || reason || 'unknown';
}

/** Legacy-compatible message key (first label family callers used). */
export function legacyReasonMessageKey(reason: string | undefined): string {
  return reasonToMessageKeys(reason).legacy;
}
