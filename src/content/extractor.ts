/**
 * extractor.ts
 * Content-script visit pipeline — now a thin facade over ContentKernel.
 * The 77-line table-driven loadSettings mapping, the ScrollMonitor pure update,
 * and the VisitReporter VALID_VISIT orchestration have been unified behind
 * ContentKernel with injected StoragePort / DomainPolicyPort / Clock / Scheduler.
 * This file owns the module singletons (pageState + kernel) for backward compat
 * and wires the default chrome-backed ports for the real extension runtime.
 * Listener registration + init() are driven by entrypoints/content-extractor.ts.
 */

import { createContentMessageSender } from './contentMessageSender.js';
import type { ExtractResult } from '../utils/contentExtractor/types.js';
import { PageState, type CleansingConfig } from './pageState.js';
import type { VisitGate } from './visitGate.js';
import type { Clock } from './domainPolicyPort.js';
import { ChromeStoragePort } from '../utils/storage/storagePort.js';
import { ChromeDomainPolicyPort } from './domainPolicyPort.js';
import { ContentKernel, IdleScheduler } from './contentKernel.js';
import { handleGetContentMessage, type GetContentHandlerDeps } from './getContentHandler.js';

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- graphify edge: keep type link between content script and visitGate
import type { VisitState, VisitGateThresholds } from './visitGate.js';

// Type-only import to establish graphify edge between content script and
// the service worker's message type definitions (PBI-02-3).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { StorageKey } from '../utils/storage/types.js';

interface OWTestState {
    maxScrollPercentage: number;
    isValidVisitReported: boolean;
    startTime: number;
    minVisitDuration: number;
    minScrollDepth: number;
    duration: number;
}

declare global {
    interface Window {
        __OW_TEST_STATE?: OWTestState;
    }
}

// 【状態管理】: Content Script単位の可変状態をPageStateインスタンスに集約
const pageState = new PageState();

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

/**
 * Factory for VisitGate bound to current pageState thresholds. Allows clock
 * injection for tests. Single implementation lives in ContentKernel (PBI-14);
 * this stays as a 1-line delegation so the construction site is unique.
 */
export function createVisitGate(clock?: Clock): VisitGate {
    return kernel.createVisitGate(clock);
}

/**
 * 有効な訪問条件をチェックする
 */
export function checkVisitConditions(): void {
    return kernel.checkVisitConditions();
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

/**
 * Deps bundle for the GET_CONTENT handler, bound to this module's singleton
 * kernel. runtimeId is read live so hosted contexts can be distinguished.
 */
export function buildGetContentDeps(): GetContentHandlerDeps {
    return {
        extractPageContent: (config) => kernel.extractPageContent(config),
        applyExtractResultToPageState: (result) => kernel.applyExtractResultToPageState(result),
        pageState,
        runtimeId: typeof globalThis.chrome !== 'undefined' ? chrome.runtime?.id : undefined,
    };
}

/**
 * Register the GET_CONTENT listener. No-op where chrome.runtime.onMessage is
 * unavailable (e.g. unit tests importing this module). Driven by
 * entrypoints/content-extractor.ts in production.
 */
export function registerGetContentListener(): void {
    if (typeof globalThis.chrome !== 'undefined' && chrome.runtime?.onMessage) {
        // 【ポップアップからのメッセージハンドラ】: 手動コンテンツ取得要求に応答
        const deps = buildGetContentDeps();
        chrome.runtime.onMessage.addListener((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
            handleGetContentMessage(message, sender, sendResponse, deps);
        });
    }
}

// Backing singleton — the facade above delegates to it. Tests reach module
// state via __tests__/helpers/contentTestkit.ts; production driving
// (registerGetContentListener + init) is owned by entrypoints/content-extractor.ts.
export { kernel };
