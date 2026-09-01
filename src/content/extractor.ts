/**
 * extractor.ts
 * Content-script visit pipeline — now a thin facade over ContentKernel.
 * The 77-line table-driven loadSettings mapping, the ScrollMonitor pure update,
 * and the VisitReporter VALID_VISIT orchestration have been unified behind
 * ContentKernel with injected StoragePort / DomainPolicyPort / Clock / Scheduler.
 * This file preserves the public exports for backward compat and wires the
 * default chrome-backed ports for the real extension runtime.
 */

import { createContentMessageSender } from './contentMessageSender.js';
import type { ExtractResult } from '../utils/contentExtractor/types.js';
import { PageState, type CleansingConfig } from './pageState.js';
import { VisitGate } from './visitGate.js';
import { ChromeStoragePort } from '../utils/storage/storagePort.js';
import { ChromeDomainPolicyPort } from './domainPolicyPort.js';
import { ContentKernel, IdleScheduler } from './contentKernel.js';

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- graphify edge: keep type link between content script and visitGate
import type { VisitState, VisitGateThresholds } from './visitGate.js';

// Type-only import to establish graphify edge between content script and
// the service worker's message type definitions (PBI-02-3).
import type { StorageKey } from '../utils/storage/types.js';

interface OWTestState {
    maxScrollPercentage: number;
    isValidVisitReported: boolean;
    startTime: number;
    minVisitDuration: number;
    minScrollDepth: number;
    duration: number;
}

interface ContentMessage {
    type: string;
}

declare global {
    interface Window {
        __OW_TEST_STATE?: OWTestState;
    }
}

// 【状態管理】: Content Script単位の可変状態をPageStateインスタンスに集約
const pageState = new PageState();

/**
 * PBI-34: 後方互換用。テスト等でモジュールレベルのPageStateインスタンスに
 * アクセスする必要がある場合に使用。本番コードでは原則pageStateを直接参照する。
 */
export function getPageStateForTesting(): Readonly<PageState> {
    return pageState;
}

// モジュールレベルでリトライ付き送信者を作成
const messageSender = createContentMessageSender(2);

// ContentKernel — single unified visit pipeline (StoragePort + DomainPolicyPort + Clock + Scheduler)
const storagePort = new ChromeStoragePort();
const domainPolicyPort = new ChromeDomainPolicyPort(storagePort);
const kernel = new ContentKernel(storagePort, domainPolicyPort, () => Date.now(), new IdleScheduler(), {
    pageState,
    sender: messageSender,
});

/**
 * コンテンツを抽出する共通関数（純粋関数）
 * PageStateを変更しない（PBI-28）。呼び出し元が戻り値を使って統計を更新する。
 */
export function extractPageContent(config: CleansingConfig = pageState.cleansingConfig): ExtractResult {
    return kernel.extractPageContent(config);
}

/**
 * extractPageContent() の結果を pageState に反映する（オーケストレーター側の責務）。
 */
export function applyExtractResultToPageState(result: ExtractResult): void {
    kernel.applyExtractResultToPageState(result);
}

/**
 * 設定をロードする — ContentKernel.loadSettings に統一（76行テーブル駆動マッピングの唯一の実装）。
 */
export function loadSettings(): Promise<void> {
    return kernel.loadSettings();
}

/**
 * 有効な訪問の条件を判定する（テスト可能な純粋関数）
 */
export function shouldRecordVisit(
    duration: number,
    scrollPercent: number,
    minDuration?: number,
    minScroll?: number,
): boolean {
    return kernel.shouldRecordVisit(duration, scrollPercent, minDuration, minScroll);
}

/** Factory for VisitGate bound to current pageState thresholds. Allows clock injection for tests. */
export function createVisitGate(clock: () => number = () => Date.now()): VisitGate {
    // Keep original semantics: new gate with current thresholds + injected clock
    return new VisitGate(pageState.toVisitGateThresholds(), clock);
}

/**
 * 有効な訪問条件をチェックする
 */
export function checkVisitConditions(): void {
    return kernel.checkVisitConditions();
}

/**
 * Throttle function using requestAnimationFrame
 */
export function throttle<T extends (...args: unknown[]) => void>(fn: T): T {
    return kernel.throttle(fn);
}

/**
 * 最大スクロール深度を更新する
 */
export function updateMaxScroll(): void {
    return kernel.updateMaxScroll();
}

/**
 * 有効な訪問を報告する — VisitReporter（単一 VALID_VISIT 送信）に統一
 */
export async function reportValidVisit(): Promise<void> {
    return kernel.reportValidVisit();
}

// showPrivacyConfirmDialog is in ./privacyDialog.ts — re-export for backward compat
export { showPrivacyConfirmDialog } from './privacyDialog.js';

/**
 * Schedule the next periodic check using injected Scheduler (IdleScheduler → requestIdleCallback fallback)
 */
export function scheduleNextCheck(): void {
    return kernel.scheduleNextCheck();
}

/**
 * 定期実行を開始する
 */
export function startPeriodicCheck(): void {
    return kernel.startPeriodicCheck();
}

/**
 * 定期実行を停止する
 */
export function stopPeriodicCheck(): void {
    return kernel.stopPeriodicCheck();
}

/**
 * 初期化処理 — isTrusted guard と E2E data-ow-e2e-test 分岐を ContentKernel に統一
 */
export async function init(): Promise<void> {
    return kernel.init();
}

// Guard allows this module to be imported in test environments where
// globalThis.chrome is undefined or chrome.runtime is not available.
if (typeof globalThis.chrome !== 'undefined' && chrome.runtime?.onMessage) {
    // 【ポップアップからのメッセージハンドラ】: 手動コンテンツ取得要求に応答
    chrome.runtime.onMessage.addListener((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
        if (typeof message !== 'object' || message === null || !('type' in message)) return;
        const msg = message as ContentMessage;
        if (msg.type !== 'GET_CONTENT') return;
        if (sender.id !== chrome.runtime.id) return;
        const extractResult = extractPageContent();
        applyExtractResultToPageState(extractResult);
        const content = extractResult.content;
        sendResponse({
            content,
            cleansedReason: pageState.lastCleansedReason,
            cleanseStats: pageState.lastCleanseStats,
            byteStats: {
                pageBytes: pageState.lastByteStats.pageBytes || undefined,
                candidateBytes: pageState.lastByteStats.candidateBytes || undefined,
                originalBytes: pageState.lastByteStats.originalBytes || undefined,
                cleansedBytes: pageState.lastByteStats.cleansedBytes || undefined,
            },
            aiSummaryCleansedStats: {
                aiSummaryOriginalBytes: pageState.lastAiSummaryCleansedStats.aiSummaryOriginalBytes || undefined,
                aiSummaryCleansedBytes: pageState.lastAiSummaryCleansedStats.aiSummaryCleansedBytes || undefined,
                aiSummaryCleansedElements: pageState.lastAiSummaryCleansedStats.aiSummaryCleansedElements || undefined,
                aiSummaryCleansedReason: pageState.lastAiSummaryCleansedStats.aiSummaryCleansedReason !== 'none' ? pageState.lastAiSummaryCleansedStats.aiSummaryCleansedReason : undefined,
                aiSummaryCleansedReasons: pageState.lastAiSummaryCleansedStats.aiSummaryCleansedReasons
            },
            fallbackTriggered: pageState.lastFallbackTriggered
        });
    });

    // 【初期化実行】
    void init();
}

// Re-export kernel for tests that want to assert on injected seams
export { kernel as __kernelForTesting };
export type { StorageKey };
