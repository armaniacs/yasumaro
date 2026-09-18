/**
 * historyEntryPresentation.ts (PBI 2026-09-15-11)
 *
 * 履歴エントリの表示ドメイン判断を集約する純粋関数 module。
 *
 * WHY: クレンジング削減率の計算（fallback 連鎖含む）が View に inline で
 * 書かれており、定義変更（丸め・fallback 順序）時に View/Model の同期編集が
 * 必要だった。ここに集約することで定義の単一所有を型とテストで保証する。
 *
 * 純粋関数のみ — DOM も chrome API も触らない（View が HTML 化を担当）。
 */

import type { BrowsingLogEntry } from './sqliteHistoryQuery.js';

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
