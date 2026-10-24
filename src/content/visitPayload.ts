/**
 * visitPayload.ts (PBI 2026-09-15-14)
 *
 * 記録ペイロード wire 契約の唯一の所有者。
 *
 * WHY: かつては4箇所が独立に field 選別と梱包を行っていた（visitReporter の
 * flat spread、force 再送の stats 落下、getContentHandler の nested 梱包、
 * RecordingData の型）。1つの field 追加が4ファイルの編集を要求し、force
 * 再送で stats が落下する drift が実在していた。
 *
 * この module が PageState → RecordingData / ContentResponse の変換を唯一
 * 所有する。呼び出し側は content と force だけ知ればよい。
 */

import type { PageState } from './pageState.js';
import type { RecordingData, ContentResponse } from '../messaging/types.js';
import type { AiSummaryCleansedReason } from '../utils/commonTypes.js';

/** Byte-stat subset shared by the VALID_VISIT payload and the GET_CONTENT reply. */
export interface VisitByteStats {
  pageBytes?: number | undefined;
  candidateBytes?: number | undefined;
  originalBytes?: number | undefined;
  cleansedBytes?: number | undefined;
}

/** AI-cleanse stat subset shared by both send paths. */
export interface VisitAiStats {
  aiSummaryOriginalBytes?: number | undefined;
  aiSummaryCleansedBytes?: number | undefined;
  aiSummaryCleansedElements?: number | undefined;
  aiSummaryCleansedReason?: AiSummaryCleansedReason | undefined;
  aiSummaryCleansedReasons?: string[] | undefined;
}

/** One field-selection source for both send paths (auto-visit + manual fetch). */
export interface VisitStats {
  byteStats: VisitByteStats;
  aiStats: VisitAiStats;
  fallbackTriggered: boolean;
  fallbackReason: string | undefined;
}

/**
 * Build the shared stat selection from PageState. The `|| undefined` /
 * `!== 'none'` normalization lives here once — not once per send path.
 * Owned by this wire adapter so both send paths share one selection.
 */
export function buildVisitStats(pageState: PageState): VisitStats {
  const ai = pageState.lastAiSummaryCleansedStats;
  return {
    byteStats: {
      pageBytes: pageState.lastByteStats.pageBytes || undefined,
      candidateBytes: pageState.lastByteStats.candidateBytes || undefined,
      originalBytes: pageState.lastByteStats.originalBytes || undefined,
      cleansedBytes: pageState.lastByteStats.cleansedBytes || undefined,
    },
    aiStats: {
      aiSummaryOriginalBytes: ai.aiSummaryOriginalBytes || undefined,
      aiSummaryCleansedBytes: ai.aiSummaryCleansedBytes || undefined,
      aiSummaryCleansedElements: ai.aiSummaryCleansedElements || undefined,
      aiSummaryCleansedReason:
        ai.aiSummaryCleansedReason !== 'none' ? ai.aiSummaryCleansedReason : undefined,
      aiSummaryCleansedReasons: ai.aiSummaryCleansedReasons,
    },
    fallbackTriggered: pageState.lastFallbackTriggered,
    fallbackReason: pageState.lastFallbackReason,
  };
}

/** RecordingData の field サブセット — content script が送信できる部分。
 *  title / url は background 側で補完されるため含まない。 */
export type VisitWirePayload = { content: string } & {
    [K in 'force' | 'pageBytes' | 'candidateBytes' | 'originalBytes' | 'cleansedBytes' |
    'aiSummaryOriginalBytes' | 'aiSummaryCleansedBytes' | 'aiSummaryCleansedElements' |
    'aiSummaryCleansedReason' | 'aiSummaryCleansedReasons' | 'fallbackTriggered' |
    'fallbackReason' | 'visitDurationSeconds' | 'scrollRatioPercent']?: RecordingData[K] | undefined;
};

/**
 * PageState + content から RecordingData（VALID_VISIT / MANUAL_RECORD ペイロード）
 * を構築する。force 再送でも同一の stats 選別が適用される — 呼び出し側は
 * content と force だけを渡し、10超の byte/ai field の正規化を意識しない。
 * PBI 2026-10-23-02: metrics は visit_duration/scroll_ratio の NULL 解消の
 * 乗り手。呼び出し側が clock を知っているので、ここでは丸めない。
 */
export function toValidVisitPayload(
    state: PageState,
    content: string,
    opts?: { force?: boolean; metrics?: { visitDurationSeconds: number; scrollRatioPercent: number } }
): VisitWirePayload {
    const stats: VisitStats = buildVisitStats(state);
    return {
        content,
        ...stats.byteStats,
        ...stats.aiStats,
        fallbackTriggered: stats.fallbackTriggered,
        ...(stats.fallbackReason !== undefined ? { fallbackReason: stats.fallbackReason } : {}),
        ...(opts?.metrics ? { visitDurationSeconds: opts.metrics.visitDurationSeconds } : {}),
        ...(opts?.metrics ? { scrollRatioPercent: opts.metrics.scrollRatioPercent } : {}),
        ...(opts?.force ? { force: true } : {}),
    };
}

/**
 * GET_CONTENT 応答 — ContentResponse からの Pick 派生（PBI 2026-10-05-30）。
 * byte/ai 統計は buildVisitStats の undefined 正規化済み bag を運ぶため
 * SSOT の必須形ではなく VisitStats 由来とする。scalar field の手書き
 * コピーは置かない。
 */
export type GetContentReply = Pick<
    ContentResponse,
    'content' | 'cleansedReason' | 'cleanseStats' | 'fallbackTriggered'
> & {
    // Declared explicitly (not via Pick): with exactOptionalPropertyTypes,
    // assigning an explicit `undefined` to the SSOT's optional field fails,
    // and the stats bag always carries the key.
    fallbackReason: string | undefined;
    byteStats: VisitStats['byteStats'];
    aiSummaryCleansedStats: VisitStats['aiStats'];
};

/**
 * GET_CONTENT 応答を構築する。VALID_VISIT ペイロードと同一の field 選別が
 * 適用される（一つの所有者、per-path drift なし）。
 */
export function toGetContentReply(
    state: PageState,
    content: string
): GetContentReply {
    const stats = buildVisitStats(state);
    return {
        content,
        cleansedReason: state.lastCleansedReason,
        cleanseStats: state.lastCleanseStats,
        byteStats: stats.byteStats,
        aiSummaryCleansedStats: stats.aiStats,
        fallbackTriggered: stats.fallbackTriggered,
        fallbackReason: stats.fallbackReason,
    };
}
