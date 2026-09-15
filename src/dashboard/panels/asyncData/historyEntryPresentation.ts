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
