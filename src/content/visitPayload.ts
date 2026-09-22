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
import type { RecordingData } from '../messaging/types.js';
import { buildVisitStats, type VisitStats } from './visitReporter.js';

/** RecordingData の field サブセット — content script が送信できる部分。
 *  title / url は background 側で補完されるため含まない。 */
export type VisitWirePayload = { content: string } & {
    [K in 'force' | 'pageBytes' | 'candidateBytes' | 'originalBytes' | 'cleansedBytes' |
    'aiSummaryOriginalBytes' | 'aiSummaryCleansedBytes' | 'aiSummaryCleansedElements' |
    'aiSummaryCleansedReason' | 'aiSummaryCleansedReasons' | 'fallbackTriggered' |
    'fallbackReason']?: RecordingData[K] | undefined;
};

/**
 * PageState + content から RecordingData（VALID_VISIT / MANUAL_RECORD ペイロード）
 * を構築する。force 再送でも同一の stats 選別が適用される — 呼び出し側は
 * content と force だけを渡し、10超の byte/ai field の正規化を意識しない。
 */
export function toValidVisitPayload(
    state: PageState,
    content: string,
    opts?: { force?: boolean }
): VisitWirePayload {
    const stats: VisitStats = buildVisitStats(state);
    return {
        content,
        ...stats.byteStats,
        ...stats.aiStats,
        fallbackTriggered: stats.fallbackTriggered,
        ...(stats.fallbackReason !== undefined ? { fallbackReason: stats.fallbackReason } : {}),
        ...(opts?.force ? { force: true } : {}),
    };
}

/**
 * GET_CONTENT 応答を構築する。VALID_VISIT ペイロードと同一の field 選別が
 * 適用される（一つの所有者、per-path drift なし）。
 */
export function toGetContentReply(
    state: PageState,
    content: string
): {
    content: string;
    cleansedReason: string | undefined;
    cleanseStats: PageState['lastCleanseStats'];
    byteStats: VisitStats['byteStats'];
    aiSummaryCleansedStats: VisitStats['aiStats'];
    fallbackTriggered: boolean;
    /** PBI 05: 発動理由（未発動時は undefined） */
    fallbackReason: string | undefined;
} {
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
