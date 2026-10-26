/**
 * captureFailureReasons.ts
 *
 * Capture-failure reason table (PBI 2026-10-22-06, slice 1: failure visibility).
 * 記録できない理由が分かる: every non-recorded outcome in the tree carries a
 * reason code; this table maps the known codes to a display category
 * (権限・CSP・種別・同意・保存・重複) so the diagnostics surface shows the
 * reason instead of failing silently (沈黙の失敗にしない).
 *
 * Slice scope (honest): this slice ships only the vocabulary — the code
 * table, the scope lists, and the classifier. The diagnostics-panel wiring
 * that renders the last outcome rides a later slice and consumes this table.
 *
 * 縮退の出口: unknown codes classify as internal/unknown — the classifier
 * never throws and never drops a reason, it just marks it unlisted.
 */

/** Display categories for a non-recorded outcome (PBI's own words first). */
export type CaptureFailureCategory =
  | 'permission'
  | 'csp'
  | 'kind'
  | 'consent'
  | 'storage'
  | 'duplicate'
  | 'internal';

/** One known reason: the code the tree emits and where it displays. */
export interface CaptureFailureReason {
  /** The exact reason string the pipeline/content layer emits. */
  code: string;
  category: CaptureFailureCategory;
  /** i18n key for the user-facing explanation (ja/en added when wired). */
  i18nKey: string;
}

/**
 * Known reason codes, grounded in the tree (pipeline outcomes, admission
 * rejections, save-phase skips). A code missing here is a drift the table
 * test pins as a red entry instead of a silent display gap.
 */
export const CAPTURE_FAILURE_REASONS: readonly CaptureFailureReason[] = [
  { code: 'PRIVATE_PAGE_DETECTED', category: 'permission', i18nKey: 'captureFailure_privatePage' },
  { code: 'domain_excluded', category: 'permission', i18nKey: 'captureFailure_domainExcluded' },
  { code: 'csp_blocked', category: 'csp', i18nKey: 'captureFailure_cspBlocked' },
  { code: 'non-html', category: 'kind', i18nKey: 'captureFailure_nonHtml' },
  { code: 'unsupported-kind', category: 'kind', i18nKey: 'captureFailure_unsupportedKind' },
  { code: 'privacy_consent_required', category: 'consent', i18nKey: 'captureFailure_consentRequired' },
  { code: 'rate_limited', category: 'consent', i18nKey: 'captureFailure_rateLimited' },
  { code: 'paused', category: 'consent', i18nKey: 'captureFailure_paused' },
  { code: 'sqlite-client-absent', category: 'storage', i18nKey: 'captureFailure_sqliteAbsent' },
  { code: 'no-client', category: 'storage', i18nKey: 'captureFailure_noClient' },
  { code: 'no-write', category: 'storage', i18nKey: 'captureFailure_noWrite' },
  { code: 'obsidian-disabled', category: 'storage', i18nKey: 'captureFailure_obsidianDisabled' },
  { code: 'obsidian-write-failed', category: 'storage', i18nKey: 'captureFailure_obsidianWriteFailed' },
  { code: 'pipeline-error', category: 'storage', i18nKey: 'captureFailure_pipelineError' },
  { code: 'same_day', category: 'duplicate', i18nKey: 'captureFailure_sameDay' },
];

/** Classified outcome: the category plus whether the code is listed. */
export interface ClassifiedCaptureFailure {
  code: string;
  category: CaptureFailureCategory;
  /** False when the code is not in the table (drift to pin, not to drop). */
  known: boolean;
}

/**
 * Classifies one emitted reason for display. 縮退の出口: unknown codes and
 * non-strings classify as internal/unknown — never a throw, never a drop.
 */
export function classifyCaptureFailure(reason: unknown): ClassifiedCaptureFailure {
  if (typeof reason !== 'string' || reason === '') {
    return { code: '', category: 'internal', known: false };
  }
  const entry = CAPTURE_FAILURE_REASONS.find((row) => row.code === reason);
  if (entry) return { code: reason, category: entry.category, known: true };
  return { code: reason, category: 'internal', known: false };
}

/**
 * Capture scope lists (DoD: 対応範囲と対象外一覧). Single source: the docs
 * render from this table so the lists cannot drift between code and doc.
 * Statuses: done (ships today), planned (段階着手), excluded (対象外と明示).
 */
export type CaptureScopeStatus = 'done' | 'planned' | 'excluded';

export interface CaptureScopeEntry {
  target: string;
  status: CaptureScopeStatus;
}

export const CAPTURE_SCOPE: readonly CaptureScopeEntry[] = [
  { target: 'article pages (valid-visit auto recording)', status: 'done' },
  { target: 'PDF viewer', status: 'planned' },
  { target: 'video captions', status: 'planned' },
  // PBI 2026-10-22-06 slice 2: bounded gate re-arm (lateContentRescan.ts)
  // re-extracts grown SPA content through the same pipeline. Auto-append
  // without any scroll event still ends at the first excerpt (recorded limit).
  { target: 'SPA late-loaded content', status: 'done' },
  { target: 'file:// pages', status: 'excluded' },
  { target: 'auth-walled pages', status: 'excluded' },
  { target: 'paywalled pages', status: 'excluded' },
  { target: 'canvas-rendered pages', status: 'excluded' },
];
