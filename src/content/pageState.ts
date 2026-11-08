/**
 * pageState.ts
 * Encapsulates content-script-scoped mutable state that was previously
 * held as module-level `let` bindings in extractor.ts. One instance is
 * created per content script injection (see extractor.ts bottom), and
 * tests create a fresh instance per case instead of resetting globals.
 */

import type { AiSummaryCleansedReason } from '../utils/commonTypes.js';
import { createDefaultCleansingConfig } from '../utils/cleansingConfig.js';
// PBI 2026-09-21-16 (Option A): CleansingConfig type + defaults are owned by
// src/utils/cleansingConfig.js (pure data, no DOM/chrome deps). This module
// re-exports them so existing `content/pageState.js` import paths keep working.
export type { CleansingConfig } from '../utils/cleansingConfig.js';
export {
    THRESHOLD_CONFIG_DEFAULTS,
    DEFAULT_CLEANSING_CONFIG,
    createDefaultCleansingConfig,
} from '../utils/cleansingConfig.js';
import type { CleansingConfig } from '../utils/cleansingConfig.js';
import { DEFAULT_MIN_SCROLL_DEPTH, DEFAULT_MIN_VISIT_DURATION } from '../utils/visitThresholds.js';

// ---------------------------------------------------------------------------
// CleansingConfig type + defaults: owned by src/utils/cleansingConfig.js,
// re-exported above for backward compatibility.
// ---------------------------------------------------------------------------

export class PageState {
    // 【訪問状態】: スクロール深度や訪問時間の監視に使用
    minVisitDuration: number = DEFAULT_MIN_VISIT_DURATION;
    minScrollDepth: number = DEFAULT_MIN_SCROLL_DEPTH;
    startTime: number = Date.now();
    maxScrollPercentage: number = 0;
    isValidVisitReported: boolean = false;
    /**
     * PBI 2026-10-31-01: true once the visit gate opened and a report was
     * attempted (ContentKernel.reportValidVisit). The skip-reason recording
     * reads it on page leave so a failed send is not claimed as a condition
     * skip — the settle flag alone cannot distinguish "the gate never opened"
     * from "the gate opened but the send failed".
     */
    visitReportAttempted: boolean = false;
    checkIntervalId: number | null = null;

    /**
     * VisitGate 注入用の thresholds を返す純粋ヘルパー。
     * extractor.init() / checkVisitConditions が VisitGate 生成時に利用する。
     */
    toVisitGateThresholds(): { minDuration: number; minScroll: number } {
        return { minDuration: this.minVisitDuration, minScroll: this.minScrollDepth };
    }

    /**
     * PBI 2026-11-08-02: SPA navigation reset. history pushState/replaceState
     * and popstate do not reload the content script, so the previous page's
     * startTime, scroll depth and report flags would otherwise leak into the
     * new page's gating. Thresholds themselves are reloaded by
     * ContentKernel.loadSettings after the reset; the gating caches rebuild
     * on the changed startTime.
     */
    resetVisitState(startTime: number): void {
        this.startTime = startTime;
        this.maxScrollPercentage = 0;
        this.isValidVisitReported = false;
        this.visitReportAttempted = false;
        this.reportedContentChars = 0;
        this.lateRescanCount = 0;
    }

    /**
     * VisitGate.isReportable に渡す VisitState を返す純粋ヘルパー。
     */
    toVisitState(): { startTime: number; maxScrollPercentage: number; isValidVisitReported: boolean } {
        return {
            startTime: this.startTime,
            maxScrollPercentage: this.maxScrollPercentage,
            isValidVisitReported: this.isValidVisitReported,
        };
    }

    // 【クレンジング設定】: コンテンツクレンジングとAI要約クレンジングの設定を一括管理
    cleansingConfig: CleansingConfig = createDefaultCleansingConfig();

    // 【クレンジング情報】: 直近の抽出で適用されたクレンジング情報を保持
    lastCleansedReason: 'hard' | 'keyword' | 'both' | 'none' = 'none';
    lastCleanseStats: { hardStripRemoved: number; keywordStripRemoved: number; totalRemoved: number } = {
        hardStripRemoved: 0,
        keywordStripRemoved: 0,
        totalRemoved: 0
    };

    // 【バイト数情報】: 直近の抽出で適用されたバイト数情報を保持
    lastByteStats: { pageBytes: number; candidateBytes: number; originalBytes: number; cleansedBytes: number } = {
        pageBytes: 0,
        candidateBytes: 0,
        originalBytes: 0,
        cleansedBytes: 0
    };

    // 【AI要約クレンジング情報】: 直近の抽出で適用されたAI要約クレンジング情報を保持
    lastAiSummaryCleansedStats: {
        aiSummaryOriginalBytes: number;
        aiSummaryCleansedBytes: number;
        aiSummaryCleansedElements: number;
        aiSummaryCleansedReason: AiSummaryCleansedReason;
        aiSummaryCleansedReasons?: string[];
    } = {
        aiSummaryOriginalBytes: 0,
        aiSummaryCleansedBytes: 0,
        aiSummaryCleansedElements: 0,
        aiSummaryCleansedReason: 'none'
    };

    // 【フォールバック情報】: 直近の抽出でフォールバックが発動したかを保持
    lastFallbackTriggered: boolean = false;
    /** PBI 05: 発動理由（triggered 時のみ。'short_content' | 'over_cleansed' | 'content_overcut' | 'candidate_too_small'） */
    lastFallbackReason: string | undefined = undefined;

    /**
     * PBI 2026-10-22-06 slice 2 (SPA late-content re-scan): visible length
     * at the last terminal report. The re-arm verdict compares the live
     * page against this baseline; wherever isValidVisitReported commits,
     * this commits beside it.
     */
    reportedContentChars: number = 0;
    /** Bounded re-arms per page view (cap lives in lateContentRescan.ts). */
    lateRescanCount: number = 0;
}
