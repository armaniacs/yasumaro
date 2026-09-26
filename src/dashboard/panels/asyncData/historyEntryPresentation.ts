/**
 * historyEntryPresentation.ts (PBI 2026-09-15-11)
 *
 * 履歴エントリの表示ドメイン判断を集約する純粋関数 module。
 *
 * WHY: クレンジング削減率の計算（fallback 連鎖含む）が View に inline で
 * 書かれており、定義変更（丸め・fallback 順序）時に View/Model の同期編集が
 * 必要だった。ここに集約することで定義の単一所有を型とテストで保証する。
 *
 * 純粋関数のみ — DOM も chrome API も触らない。HTML 文字列の組み立てまで
 * 所有するが、DOM への挿入は View が担当する（PBI 2026-09-23-01 の deep module）。
 */

import type { BrowsingLogEntry } from './sqliteHistoryQuery.js';
import { tOrKey as t } from '../../../utils/i18n.js';
import { escapeHtml } from '../../../utils/htmlEscape.js';
import { describeDelta } from './entryByteDelta.js';
import { formatBytes } from '../../byteFormat.js';

export interface CleansingReduction {
    /** 送信前の元バイト数（null は計算不能 — 呼び出し側で非表示にする）。 */
    base: number | null;
    /** AI に送られたバイト数（fallback 連鎖で解決）。 */
    sentToAI: number | null;
    /** 0〜1 の送信比率。 */
    sentRatio: number;
    /** 0〜99.9% にクランプされた削減率。 */
    reductionRatePercent: number;
}

/**
 * クレンジング削減率を計算する。
 *
 * fallback 連鎖（PBI 2026-09-12-02 の順序を維持）:
 *   fallback_triggered が立っている場合はクレンジング後バイトを優先し、
 *   立っていない場合は AI 要約後バイト → クレンジング後バイトの順に解決する。
 *
 * @returns 計算不能（base/sent 未設定・base=0）のとき null。
 */
export function computeCleansingReduction(entry: BrowsingLogEntry): CleansingReduction | null {
    const base = entry.page_bytes;
    const sentToAI = (entry.fallback_triggered ?? 0)
        ? (entry.cleansed_bytes ?? entry.original_bytes)
        : (entry.ai_summary_cleansed_bytes ?? entry.ai_summary_original_bytes ?? entry.cleansed_bytes ?? entry.original_bytes);

    if (base == null || sentToAI == null || base === 0) return null;

    const sentRatio = Math.min(sentToAI / base, 1);
    const reductionRatePercent = Math.min((1 - sentRatio) * 100, 99.9);

    return { base, sentToAI, sentRatio, reductionRatePercent };
}

/**
 * Reason why a diagnostic row cannot show numbers.
 *
 * - 'no-ai': recorded without AI, so no bytes or tokens were measured.
 * - 'empty': measurement ran but there was nothing to measure (0-byte side).
 * - 'unmeasured': bytes are missing (legacy record, disabled cleansing, or
 *   partial pipeline output). Generic wording to avoid misattribution.
 */
export type DiagnosticMissingReason = 'no-ai' | 'empty' | 'unmeasured';

/**
 * PBI 05: fallback_reason column → i18n key. Unknown/absent reasons return
 * null (the row is simply omitted — never a broken key in the UI).
 */
const FALLBACK_REASON_KEYS: Record<string, string> = {
    short_content: 'fallbackReasonShortContent',
    over_cleansed: 'fallbackReasonOverCleansed',
    content_overcut: 'fallbackReasonContentOvercut',
    candidate_too_small: 'fallbackReasonCandidateTooSmall',
};

export function describeFallbackReasonKey(reason: string | null | undefined): string | null {
    if (!reason) return null;
    return FALLBACK_REASON_KEYS[reason] ?? null;
}

/**
 * Entry-level classifier shared by the three diagnostic rows.
 * Checks emptiness first so a 0-byte page is never labeled as legacy.
 */
export function classifyDiagnosticMissing(entry: BrowsingLogEntry): DiagnosticMissingReason {
    if (
        entry.page_bytes === 0 || entry.candidate_bytes === 0 ||
        entry.original_bytes === 0 || entry.cleansed_bytes === 0 ||
        entry.ai_summary_original_bytes === 0 || entry.ai_summary_cleansed_bytes === 0
    ) {
        return 'empty';
    }
    if (entry.sent_tokens == null && entry.received_tokens == null && entry.ai_provider == null) {
        return 'no-ai';
    }
    return 'unmeasured';
}

/**
 * Reason for a missing extraction row. Null when the row shows numbers.
 * Row-specific emptiness takes precedence over the entry-level classifier.
 */
export function classifyExtractionMissing(entry: BrowsingLogEntry): DiagnosticMissingReason | null {
    if (entry.page_bytes != null && entry.candidate_bytes != null && entry.page_bytes > 0) {
        return null;
    }
    if (entry.page_bytes === 0 || entry.candidate_bytes === 0) return 'empty';
    return classifyDiagnosticMissing(entry);
}

/**
 * Resolved byte pair for the Content Cleansing row (PBI 2026-09-18-02).
 *
 * Single owner of the `??` fallback chain previously spelled in both the
 * View and `classifyCleansingMissing`. Uses `??` (never `||`) so a
 * legitimate 0-byte value is honored instead of falling through.
 */
export interface ResolvedCleansingBytes {
    original: number | null | undefined;
    cleansed: number | null | undefined;
}

export function resolveCleansingBytes(entry: BrowsingLogEntry): ResolvedCleansingBytes {
    return {
        original: entry.original_bytes ?? entry.candidate_bytes,
        cleansed: entry.cleansed_bytes ?? entry.original_bytes ?? entry.candidate_bytes,
    };
}

/**
 * Reason for a missing cleansing row. Null when the row shows numbers.
 * Resolves bytes via `resolveCleansingBytes` — never re-spells the chain.
 */
export function classifyCleansingMissing(entry: BrowsingLogEntry): DiagnosticMissingReason | null {
    if (entry.original_bytes == null && entry.cleansed_bytes == null) {
        return classifyDiagnosticMissing(entry);
    }
    const { original } = resolveCleansingBytes(entry);
    if (original === 0) return 'empty';
    if (original == null || original <= 0) return classifyDiagnosticMissing(entry);
    return null;
}

/**
 * Reason for a missing token row. Null when tokens or provider show numbers.
 * Single-side tokens still render numerically, so only the fully-absent
 * case falls back to the entry-level classifier.
 */
export function classifyTokensMissing(entry: BrowsingLogEntry): DiagnosticMissingReason | null {
    if (entry.sent_tokens != null || entry.received_tokens != null || entry.ai_provider != null) {
        return null;
    }
    return classifyDiagnosticMissing(entry);
}

/**
 * Reason for a missing PII masking row. Null when masking data is present.
 */
export function classifyMaskingMissing(entry: BrowsingLogEntry): DiagnosticMissingReason | null {
    if (entry.masked_count != null || (entry.original_tokens != null && entry.cleansed_tokens != null)) {
        return null;
    }
    return classifyDiagnosticMissing(entry);
}

/**
 * Reason for a missing AI summary cleansing row. Null when it shows numbers.
 */
export function classifyAiSummaryMissing(entry: BrowsingLogEntry): DiagnosticMissingReason | null {
    if (
        entry.ai_summary_original_bytes != null &&
        entry.ai_summary_cleansed_bytes != null &&
        entry.ai_summary_original_bytes > 0
    ) {
        return null;
    }
    if (entry.ai_summary_original_bytes === 0 || entry.ai_summary_cleansed_bytes === 0) return 'empty';
    return classifyDiagnosticMissing(entry);
}

// ---------------------------------------------------------------------------
// Deep-module rendering seam (PBI 2026-09-23-01).
//
// The classifiers above decide *why* a row is missing; everything below owns
// *how* that decision becomes HTML (reason-key table, separators, CSS
// classes, bar markup). Callers use `renderEntryDiagnostics` /
// `renderCleansingBar` only and never compose classifiers with row markup.
// ---------------------------------------------------------------------------

/**
 * Single owner of the missing-reason → i18n-key table. Exported so the
 * Panel can reference it instead of duplicating it; the View must not
 * import it (it renders through the two functions below).
 */
export const MISSING_REASON_KEYS: Record<DiagnosticMissingReason, string> = {
    'no-ai': 'historyMissingReasonNoAi',
    'empty': 'historyMissingReasonEmpty',
    'unmeasured': 'historyMissingReasonUnmeasured',
};

function missingReasonText(reason: DiagnosticMissingReason): string {
    return t(MISSING_REASON_KEYS[reason], []);
}

/**
 * Single seam for missing-reason rows. Owns the css class, the em-dash
 * separator, and the escape of the locale-controlled reason text, so
 * callers cannot drift apart.
 */
function pushReasonRow(parts: string[], titleKey: string, reason: DiagnosticMissingReason, cssClass: string, separator = ' — '): void {
    parts.push(`<div class="${cssClass}">${t(titleKey, [])}${separator}${escapeHtml(missingReasonText(reason))}</div>`);
}

/**
 * Full diagnostics metadata HTML for one history entry (moved verbatim
 * from the View — byte-identical output pinned by
 * historyEntryDiagnostics-characterization.test.ts).
 */
export function renderEntryDiagnostics(entry: BrowsingLogEntry): string {
    const parts: string[] = [];

    if (entry.summary && entry.summary.trim().length > 0) {
        parts.push(`<div class="history-entry-ai-summary">${escapeHtml(entry.summary)}</div>`);
    }

    if (entry.sent_tokens != null || entry.received_tokens != null) {
        const tokenParts: string[] = [];
        if (entry.sent_tokens != null) tokenParts.push(`<span class="token-label">${t('historySentTokens', [''])}:</span> <span class="token-value">${entry.sent_tokens}</span>`);
        if (entry.received_tokens != null) tokenParts.push(`<span class="token-label">${t('historyReceivedTokens', [''])}:</span> <span class="token-value">${entry.received_tokens}</span>`);
        let tokensText = `${t('historyTokens', [])}: ${tokenParts.join(', ')}`;
        if (entry.ai_duration_ms != null && entry.ai_duration_ms > 0) {
            tokensText += `, ${t('historyDuration', [])} ${(entry.ai_duration_ms / 1000).toFixed(1)}秒`;
        }
        if (entry.ai_provider) {
            const aiParts = [escapeHtml(entry.ai_provider)];
            if (entry.ai_model) aiParts.push(escapeHtml(entry.ai_model));
            tokensText += ` (AI: ${aiParts.join(' / ')})`;
        }
        parts.push(`<div class="history-entry-tokens">${tokensText}</div>`);
    } else if (entry.ai_provider) {
        const aiParts = [escapeHtml(entry.ai_provider)];
        if (entry.ai_model) aiParts.push(escapeHtml(entry.ai_model));
        let providerText = `AI: ${aiParts.join(' / ')}`;
        if (entry.ai_duration_ms != null && entry.ai_duration_ms > 0) {
            providerText += `, ${t('historyDuration', [])} ${(entry.ai_duration_ms / 1000).toFixed(1)}秒`;
        }
        parts.push(`<div class="history-entry-tokens">${providerText}</div>`);
    } else {
        // PBI 2026-09-18-21: keep the token row with a reason instead of hiding it.
        const reason = classifyTokensMissing(entry);
        if (reason) pushReasonRow(parts, 'historyTokens', reason, 'history-entry-tokens', ': ');
    }

    if (entry.page_bytes != null && entry.candidate_bytes != null) {
        // PBI 2026-09-12-21: describeDelta guards the zero-original branch that
        // used to render Infinity%/NaN% here.
        const delta = describeDelta(entry.page_bytes, entry.candidate_bytes);
        if (delta) {
            parts.push(`<div class="history-entry-token-reduction">${t('historyContentExtraction', [])} — ${t('historyBytes', [])}: ${delta.label} (${t('historyReduction', [])} ${delta.cleansed - delta.original} / ${delta.percent}%)</div>`);
        } else {
            const reason = classifyExtractionMissing(entry);
            if (reason) pushReasonRow(parts, 'historyContentExtraction', reason, 'history-entry-token-reduction');
        }
    } else {
        const reason = classifyExtractionMissing(entry);
        if (reason) pushReasonRow(parts, 'historyContentExtraction', reason, 'history-entry-token-reduction');
    }

    if (entry.original_bytes != null || entry.cleansed_bytes != null) {
        // Byte resolution lives in resolveCleansingBytes — never re-spell the chain here.
        const { original: contentOriginalB, cleansed: contentCleansedB } = resolveCleansingBytes(entry);
        const cleansingDelta = describeDelta(contentOriginalB, contentCleansedB);
        if (cleansingDelta) {
            parts.push(`<div class="history-entry-token-reduction">${t('historyContentCleansing', [])} — ${t('historyBytes', [])}: ${cleansingDelta.label} (${t('historyReduction', [])} ${cleansingDelta.cleansed - cleansingDelta.original} / ${cleansingDelta.percent}%)</div>`);
        } else {
            const reason = classifyCleansingMissing(entry);
            if (reason) pushReasonRow(parts, 'historyContentCleansing', reason, 'history-entry-token-reduction');
        }
    } else {
        const reason = classifyCleansingMissing(entry);
        if (reason) pushReasonRow(parts, 'historyContentCleansing', reason, 'history-entry-token-reduction');
    }

    if (entry.masked_count != null || (entry.original_tokens != null && entry.cleansed_tokens != null)) {
        const maskingParts: string[] = [];
        if (entry.masked_count != null) {
            maskingParts.push(`${t('historyMaskedCount', [])}: ${entry.masked_count}`);
        }
        if (entry.original_tokens != null && entry.cleansed_tokens != null) {
            maskingParts.push(`${t('historyTokens', [])}: ${entry.original_tokens} → ${entry.cleansed_tokens}`);
        }
        if (maskingParts.length > 0) {
            parts.push(`<div class="history-entry-token-reduction">${t('historyPiiMasking', [])} — ${maskingParts.join(', ')}</div>`);
        }
    } else {
        // PBI 2026-09-18-21: keep the PII row with a reason instead of hiding it.
        const reason = classifyMaskingMissing(entry);
        if (reason) pushReasonRow(parts, 'historyPiiMasking', reason, 'history-entry-token-reduction');
    }

    if (entry.ai_summary_original_bytes != null && entry.ai_summary_cleansed_bytes != null) {
        const aiDelta = describeDelta(entry.ai_summary_original_bytes, entry.ai_summary_cleansed_bytes);
        if (aiDelta) {
            parts.push(`<div class="history-entry-ai-summary-cleansing">${t('historyAiSummaryCleansing', [])}: ${aiDelta.label} (${t('historyReduction', [])} ${aiDelta.cleansed - aiDelta.original} / ${aiDelta.percent}%)</div>`);
        } else {
            const reason = classifyAiSummaryMissing(entry);
            if (reason) pushReasonRow(parts, 'historyAiSummaryCleansing', reason, 'history-entry-ai-summary-cleansing', ': ');
        }
    } else if (entry.ai_summary_original_bytes != null || entry.ai_summary_cleansed_bytes != null) {
        const reason = classifyAiSummaryMissing(entry);
        if (reason) pushReasonRow(parts, 'historyAiSummaryCleansing', reason, 'history-entry-ai-summary-cleansing', ': ');
    } else {
        // PBI 2026-09-18-21: keep the AI summary row with a reason instead of
        // hiding it when both sides are absent.
        const reason = classifyAiSummaryMissing(entry);
        if (reason) pushReasonRow(parts, 'historyAiSummaryCleansing', reason, 'history-entry-ai-summary-cleansing', ': ');
    }

    // PBI 05: フォールバック発動理由（triggered 時のみ1行追加。未知の理由は非表示）
    const fallbackReasonKey = describeFallbackReasonKey(entry.fallback_reason);
    if (fallbackReasonKey) {
        parts.push(`<div class="history-entry-token-reduction">${t('historyFallbackReason', [])}: ${t(fallbackReasonKey, [])}</div>`);
    }

    // renderCleansingBar never returns '' (PBI 2026-09-18-20):
    // unmeasurable entries keep the bar region with a reason label.
    parts.push(renderCleansingBar(entry));

    return parts.join('');
}

/**
 * Reduction bar for one history entry (moved verbatim from the View).
 * The reduction definition (fallback chain included) stays singly owned by
 * computeCleansingReduction.
 */
export function renderCleansingBar(entry: BrowsingLogEntry): string {
    const reduction = computeCleansingReduction(entry);
    if (!reduction) return renderMissingReductionBar(entry);
    const { base, sentToAI, sentRatio, reductionRatePercent } = reduction;

    const label = `${formatBytes(base as number)} → ${formatBytes(sentToAI as number)} (${reductionRatePercent.toFixed(1)}% ${t('cleansingReduction')})`;

    return `<div class="cleansing-progress-wrapper">
    <div class="cleansing-progress"><div class="cleansing-progress-bar" data-bar-width="${Math.max(sentRatio * 100, 0.2).toFixed(1)}"></div></div>
    <span class="cleansing-progress-label">${escapeHtml(label)}</span>
  </div>`;
}

/**
 * Placeholder for the reduction bar when bytes are unmeasurable
 * (PBI 2026-09-18-20). Keeps the wrapper/track/label layout identical so
 * entries without numbers do not collapse the region that measured
 * entries show. Reason wording reuses the diagnostic 3-way classification.
 */
function renderMissingReductionBar(entry: BrowsingLogEntry): string {
    const reason = classifyDiagnosticMissing(entry);
    const label = missingReasonText(reason);

    return `<div class="cleansing-progress-wrapper">
    <div class="cleansing-progress"><div class="cleansing-progress-bar cleansing-progress-bar-missing" data-bar-width="0.0"></div></div>
    <span class="cleansing-progress-label">${escapeHtml(label)}</span>
  </div>`;
}
