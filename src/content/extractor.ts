/**
 * extractor.ts
 * 【機能概要】: Webページのコンテンツを抽出し、スクロール深度や訪問時間を監視するコンテントスクリプト
 * 【設計方針】: ページの読み込み後に設定を取得し、条件を満たした場合に自動記録を実行
 * 【監視対象】:
 *   - 最小訪問時間（デフォルト: 5秒）
 *   - 最小スクロール深度（デフォルト: 50%）
 * 🟢
 */

import { createSender } from '../utils/retryHelper.js';
import { errorMessage } from '../utils/errorUtils.js';
import { reasonToStatusCode, statusCodeToMessageKey } from '../utils/privacyStatusCodes.js';
import type { ExtractResult } from '../utils/contentExtractor/types.js';
import { preparePageContent } from '../utils/pageContentPipeline.js';
import { showPrivacyConfirmDialog } from './privacyDialog.js';
import { logInfo, logWarn, logError, logDebug, ErrorCode } from '../utils/logger.js';
import { PageState, type CleansingConfig } from './pageState.js';
import { CLEANSING_RULES, THRESHOLD_RULES } from '../utils/aiSummaryCleaner/rules.js';
import { pickDefined } from '../utils/objectUtils.js';

// Type-only import to establish graphify edge between content script and
// the service worker's message type definitions (PBI-02-3).
import { StorageKeys, StorageKey } from '../utils/storage/types.js';

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

// 【設定定数】: デフォルト値の定義
const DEFAULT_MIN_VISIT_DURATION = 5; // 秒
const DEFAULT_MIN_SCROLL_DEPTH = 50;   // パーセンテージ

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
const messageSender = createSender({ maxRetries: 2, initialDelay: 50 });

/**
 * コンテンツを抽出する共通関数（純粋関数）
 * 【機能概要】: ページの本文テキスト（メインコンテンツ）を抽出し、空白文字を正規化する
 * 【抽出範囲】: メインコンテンツ（ナビゲーション、ヘッダー等除外、最大10,000文字）
 * 【処理内容】:
 *   1. メインコンテンツ（article/mainタグ等優先）を抽出
 *   2. 連続する空白文字を単一のスペースに置換
 *   3. 前後の空白を削除
 *   4. 最大10,000文字で切り詰め
 * 【改善点】: Readabilityアルゴリズムでナビゲーション等のノイズを除外
 * 【クレンジング】: 設定に従って機密情報を含む要素を削除
 *
 * pageStateを変更しない（PBI-28）。呼び出し元（オーケストレーター）が
 * 戻り値を使ってpageStateの統計フィールドを更新する責務を持つ。
 * @returns {ExtractResult} - content と抽出/クレンジング統計を含む結果オブジェクト
 */
export function extractPageContent(config: CleansingConfig = pageState.cleansingConfig): ExtractResult {
    return preparePageContent(config);
}

/**
 * extractPageContent() の結果を pageState に反映する（オーケストレーター側の責務）。
 */
function applyExtractResultToPageState(result: ExtractResult): void {
    pageState.lastCleansedReason = result.cleansedReason || 'none';
    pageState.lastCleanseStats = {
        hardStripRemoved: result.hardStripRemoved ?? 0,
        keywordStripRemoved: result.keywordStripRemoved ?? 0,
        totalRemoved: result.totalRemoved ?? 0
    };
    pageState.lastByteStats = {
        pageBytes: result.pageBytes ?? 0,
        candidateBytes: result.candidateBytes ?? 0,
        originalBytes: result.originalBytes ?? 0,
        cleansedBytes: result.cleansedBytes ?? 0
    };
    pageState.lastAiSummaryCleansedStats = {
        aiSummaryOriginalBytes: result.aiSummaryOriginalBytes ?? 0,
        aiSummaryCleansedBytes: result.aiSummaryCleansedBytes ?? 0,
        aiSummaryCleansedElements: result.aiSummaryCleansedElements ?? 0,
        aiSummaryCleansedReason: result.aiSummaryCleansedReason ?? 'none',
        ...pickDefined({ aiSummaryCleansedReasons: result.aiSummaryCleansedReasons })
    };
    pageState.lastFallbackTriggered = result.fallbackTriggered ?? false;
}

/**
 * 設定をロードする
 * 【機能概要】: chrome.storage.localから設定を読み込む
 * 【読み込みタイミング】: スクリプト読み込み時（Chrome拡張のコンテントスクリプト読み込み時）
 * 【デフォルト値】: MIN_VISIT_DURATION=5秒, MIN_SCROLL_DEPTH=50%
 * 【マイグレーション対応】: settingsキー下から値を取得（マイグレーション後の構造に対応）
 * 🟢
 */
function loadSettings(): Promise<void> {
    return new Promise((resolve) => {
        // Migration to the single 'settings' object is complete; read all values
        // from that object to reduce storage access overhead.
        chrome.storage.local.get(['settings'], (result: Record<string, unknown>) => {
            const s: Record<string, unknown> = (result['settings'] as Record<string, unknown> | undefined) ?? {};

            if (s[StorageKeys.MIN_VISIT_DURATION] !== undefined) {
                const parsedDuration = parseInt(String(s[StorageKeys.MIN_VISIT_DURATION]), 10);
                pageState.minVisitDuration = Number.isNaN(parsedDuration) ? DEFAULT_MIN_VISIT_DURATION : parsedDuration;
            }
            if (s[StorageKeys.MIN_SCROLL_DEPTH] !== undefined) {
                const parsedDepth = parseInt(String(s[StorageKeys.MIN_SCROLL_DEPTH]), 10);
                pageState.minScrollDepth = Number.isNaN(parsedDepth) ? DEFAULT_MIN_SCROLL_DEPTH : parsedDepth;
            }
            // クレンジング設定を一括読み込み
            // The 32 per-rule keys are derived from CLEANSING_RULES rather than
            // listed here individually — see pbi/2026-08-09-20. Non-rule flags
            // (hard/keyword strip, whitelist extraction, dedup) stay explicit.
            const cleansingRuleKeys: Array<[StorageKey, keyof CleansingConfig]> = CLEANSING_RULES.map(
                (rule) => [
                    rule.storageKey as StorageKey,
                    `aiSummaryCleansing${rule.key.charAt(0).toUpperCase()}${rule.key.slice(1)}` as keyof CleansingConfig,
                ],
            );
            const booleanKeys: Array<[StorageKey, keyof CleansingConfig]> = [
                [StorageKeys.CONTENT_STRIP_HARD_ENABLED, 'contentStripHardEnabled'],
                [StorageKeys.CONTENT_STRIP_KEYWORD_ENABLED, 'contentStripKeywordEnabled'],
                [StorageKeys.AI_SUMMARY_CLEANSING_ENABLED, 'aiSummaryCleansingEnabled'],
                ...cleansingRuleKeys,
                [StorageKeys.WHITELIST_EXTRACTION_ENABLED, 'whitelistExtractionEnabled'],
                [StorageKeys.CONTENT_DEDUP_ENABLED, 'contentDedupEnabled'],
            ];
            for (const [key, prop] of booleanKeys) {
                if (s[key] !== undefined) {
                    // WHY: CleansingConfig lacks index signature; dynamic property access for boolean keys
                    (pageState.cleansingConfig as unknown as Record<string, boolean | string[] | number>)[prop] = Boolean(s[key]);
                }
            }

            const stringArrayKeys: Array<[StorageKey, keyof CleansingConfig]> = [
                [StorageKeys.CONTENT_STRIP_KEYWORDS, 'contentStripKeywords'],
                [StorageKeys.AI_SUMMARY_CLEANSING_CUSTOM_PATTERNS, 'aiSummaryCleansingCustomPatterns'],
            ];
            for (const [key, prop] of stringArrayKeys) {
                if (s[key] !== undefined && Array.isArray(s[key])) {
                    // WHY: CleansingConfig lacks index signature; dynamic property access for string array keys
                    (pageState.cleansingConfig as unknown as Record<string, boolean | string[] | number>)[prop] = s[key] as string[];
                }
            }

            // Threshold settings (table-driven, bounds validated via THRESHOLD_RULES)
            for (const t of THRESHOLD_RULES) {
                if (s[t.storageKey] !== undefined) {
                    // WHY: CleansingConfig lacks index signature; dynamic property access for threshold props
                    (pageState.cleansingConfig as unknown as Record<string, number>)[t.prop] =
                        Math.max(t.min, Math.min(t.max, Number(s[t.storageKey]) || t.default));
                }
            }
            logInfo('Settings loaded', {
                minVisitDuration: pageState.minVisitDuration,
                minScrollDepth: pageState.minScrollDepth,
                aiSummaryCleansingEnabled: pageState.cleansingConfig.aiSummaryCleansingEnabled,
                aiSummaryCleansingAlt: pageState.cleansingConfig.aiSummaryCleansingAlt,
                aiSummaryCleansingMetadata: pageState.cleansingConfig.aiSummaryCleansingMetadata,
                aiSummaryCleansingAds: pageState.cleansingConfig.aiSummaryCleansingAds,
                aiSummaryCleansingNav: pageState.cleansingConfig.aiSummaryCleansingNav,
                aiSummaryCleansingSocial: pageState.cleansingConfig.aiSummaryCleansingSocial
            }, 'extractor').catch(() => { /* non-critical logging failure */ });
            resolve();
        });
    });
}

/**
 * 有効な訪問の条件を判定する（テスト可能な純粋関数）
 *
 * 呼び出し時に閾値を明示的に渡すことで、モジュールレベルの状態に依存しない。
 * パラメータ未指定時は pageState のデフォルト値を使用し後方互換性を維持する。
 *
 * @param duration - 訪問時間（秒）
 * @param scrollPercent - 最大スクロール深度（%）
 * @param minDuration - 最小訪問時間（秒）。省略時は pageState.minVisitDuration
 * @param minScroll - 最小スクロール深度（%）。省略時は pageState.minScrollDepth
 * @returns 条件を満たす場合true
 */
export function shouldRecordVisit(
    duration: number,
    scrollPercent: number,
    minDuration?: number,
    minScroll?: number,
): boolean {
    const effectiveMinDuration = minDuration ?? pageState.minVisitDuration;
    const effectiveMinScroll = minScroll ?? pageState.minScrollDepth;
    return duration >= effectiveMinDuration && scrollPercent >= effectiveMinScroll;
}

/**
 * 有効な訪問条件をチェックする
 * 【機能概要】: 現在の訪問が条件を満たしているかを確認し、条件を満たした場合は記録を実行
 * 【判定条件】:
 *   - 未報告であること（isValidVisitReported == false）
 *   - 訪問時間 >= 最小訪問時間
 *   - 最大スクロール深度 >= 最小スクロール深度
 * 【タイミング】: スクロール時および1秒ごとに定期実行
 * 【パフォーマンス】: 条件満了後に定期実行を停止して不要な処理を回避
 * 🟢
 */
function checkVisitConditions(): void {
    if (pageState.isValidVisitReported) return;

    const duration = (Date.now() - pageState.startTime) / 1000;

    // DEBUG LOG: 状態のデバッグログ（fire-and-forget）
    void logDebug('Visit status', { duration, maxScrollPercentage: pageState.maxScrollPercentage, minVisitDuration: pageState.minVisitDuration, minScrollDepth: pageState.minScrollDepth }, 'extractor');

    // E2Eテスト用フック: data-ow-e2e-test 属性が設定されている場合のみ有効
    // （ページスクリプトと Content Script は別 JS コンテキストのため DOM 経由で通信）
    if (document.documentElement.hasAttribute('data-ow-e2e-test')) {
        const state = {
            maxScrollPercentage: pageState.maxScrollPercentage,
            isValidVisitReported: pageState.isValidVisitReported,
            startTime: pageState.startTime,
            minVisitDuration: pageState.minVisitDuration,
            minScrollDepth: pageState.minScrollDepth,
            duration,
        };
        window.__OW_TEST_STATE = state;
        document.documentElement.setAttribute('data-ow-test-state', JSON.stringify(state));
    }

    // 【条件判定】: 時間とスクロール深度の両方の条件を満たす場合に記録を実行
    if (shouldRecordVisit(duration, pageState.maxScrollPercentage)) {
        console.info(`[OWeave] 自動保存トリガー: 経過${duration.toFixed(1)}s, スクロール${pageState.maxScrollPercentage.toFixed(0)}%`);
        reportValidVisit();
        // E2Eテスト用フック: 報告後に状態を更新
        if (document.documentElement.hasAttribute('data-ow-e2e-test')) {
            if (window.__OW_TEST_STATE) {
                window.__OW_TEST_STATE.isValidVisitReported = true;
            }
            document.documentElement.setAttribute('data-ow-test-state',
                JSON.stringify(window.__OW_TEST_STATE));
        }
        // 【パフォーマンス向上】: 条件満了後に定期実行を停止
        stopPeriodicCheck();
    }
}

/**
 * Throttle function using requestAnimationFrame
 * 【機能概要】: 関数呼び出しをフレーム単位で抑制し、高速スクロール時の負荷を軽減
 * @param fn - Throttle対象の関数
 * @returns Throttle化された関数
 */
function throttle<T extends (...args: unknown[]) => void>(fn: T): T {
    let lastCall = 0;
    let rafId: number | null = null;
    let lastArgs: Parameters<T> | null = null;

    const throttledFn = ((...args: Parameters<T>) => {
        lastArgs = args;
        const now = performance.now();

        // Cancel existing RAF before scheduling a new one to prevent memory leak
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }

        // 前回の呼び出しから十分時間が経過しているか確認
        const _timeSinceLastCall = now - lastCall;
        const THROTTLE_DELAY = 100; // 100ms

        rafId = requestAnimationFrame(() => {
            rafId = null;
            const callNow = performance.now() - lastCall >= THROTTLE_DELAY;
            if (callNow && lastArgs) {
                lastCall = performance.now();
                fn(...lastArgs);
            } else if (lastArgs) {
                // ディレイ未満の場合は追加のチェック
                if (performance.now() - lastCall >= THROTTLE_DELAY) {
                    lastCall = performance.now();
                    fn(...lastArgs);
                }
            }
        });
    }) as T;

    window.addEventListener('beforeunload', () => {
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
    });

    return throttledFn;
}

/**
 * 最大スクロール深度を更新する
 * 【機能概要】: 現在のスクロール位置からスクロール深度（%）を計算し、最大値を更新
 * 【計算式】: (scrollY / (scrollHeight - innerHeight)) * 100
 * 【エラーハンドリング】: 分母が0以下の場合は計算をスキップ（ページが空の場合など）
 * 🟢
 */
function updateMaxScroll(): void {
    const scrollTop = window.scrollY;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;

    // 【ゼロ除算防止】: ドキュメントの高さが0以下の場合は処理をスキップ
    if (docHeight <= 0) return;

    const scrollPercentage = (scrollTop / docHeight) * 100;

    // 【最大値更新】: 新しい最大スクロール深度を記録
    if (scrollPercentage > pageState.maxScrollPercentage) {
        pageState.maxScrollPercentage = scrollPercentage;
        // console.log(`New Max Scroll: ${pageState.maxScrollPercentage.toFixed(1)}%`);
    }

    checkVisitConditions();
}

/**
 * 有効な訪問を報告する
 * 【機能概要】: 条件を満たした訪問をバックグラウンドスクリプトに報告し、記録処理を実行
 * 【送信内容】: コンテンツテキスト（max 10,000文字）
 * 【エラーハンドリング】:
 *   - Service Worker未対応: リトライヘルパーにより自動リトライ
 *   - その他エラー: コンソールにエラーログを出力
 * 🟢
 */
async function reportValidVisit(): Promise<void> {
    pageState.isValidVisitReported = true;
    void logInfo('Sending VALID_VISIT', {}, 'extractor');
    console.info('[OWeave] VALID_VISIT 送信開始');

    const extractResult = extractPageContent();
    applyExtractResultToPageState(extractResult);
    const content = extractResult.content;

    try {
        const response = await messageSender.sendMessageWithRetry({
            type: 'VALID_VISIT',
            payload: {
                content: content,
                pageBytes: pageState.lastByteStats.pageBytes || undefined,
                candidateBytes: pageState.lastByteStats.candidateBytes || undefined,
                originalBytes: pageState.lastByteStats.originalBytes || undefined,
                cleansedBytes: pageState.lastByteStats.cleansedBytes || undefined,
                aiSummaryOriginalBytes: pageState.lastAiSummaryCleansedStats.aiSummaryOriginalBytes || undefined,
                aiSummaryCleansedBytes: pageState.lastAiSummaryCleansedStats.aiSummaryCleansedBytes || undefined,
                aiSummaryCleansedElements: pageState.lastAiSummaryCleansedStats.aiSummaryCleansedElements || undefined,
                aiSummaryCleansedReason: pageState.lastAiSummaryCleansedStats.aiSummaryCleansedReason !== 'none' ? pageState.lastAiSummaryCleansedStats.aiSummaryCleansedReason : undefined,
                aiSummaryCleansedReasons: pageState.lastAiSummaryCleansedStats.aiSummaryCleansedReasons,
                fallbackTriggered: pageState.lastFallbackTriggered
            }
        });
        void logDebug('VALID_VISIT response', { response }, 'extractor');
        console.info('[OWeave] VALID_VISIT レスポンス:', JSON.stringify(response));

        // レスポンスの成功フラグをチェック
        if (response && !response.success) {
            if (response.error === 'DOMAIN_BLOCKED') {
                // 正常な動作: このドメインはブロック対象のため記録しない
                return;
            }

            // PRIVATE_PAGE_DETECTED エラーの処理
            if (response.error === 'PRIVATE_PAGE_DETECTED') {
                // confirmationRequired=true の場合のみダイアログを表示
                // （skip モードでは confirmationRequired が返らないのでダイアログ不要）
                if (!response.confirmationRequired) {
                    return;
                }

                const statusCode = reasonToStatusCode(response.reason);
                const messageKey = statusCodeToMessageKey(statusCode);
                const reasonLabel = chrome.i18n.getMessage(messageKey)
                    || chrome.i18n.getMessage(`privatePageReason_${(response.reason || '').replace('-', '')}`)
                    || response.reason || 'unknown';

                const userConfirmed = await showPrivacyConfirmDialog(statusCode, reasonLabel);

                if (userConfirmed) {
                    // force flagを立てて再送信
                    try {
                        await messageSender.sendMessageWithRetry({
                            type: 'VALID_VISIT',
                            payload: {
                                content: content,
                                force: true
                            }
                        });
                    } catch (retryError: unknown) {
                        await logError('Failed to force save private page', { error: errorMessage(retryError) }, ErrorCode.INTERNAL_ERROR, 'extractor');
                    }
                }
                return;
            }

            await logError('Background worker error', { error: response.error }, ErrorCode.INTERNAL_ERROR, 'extractor');
        }
    } catch (error: unknown) {
        const msg = errorMessage(error);
        if (msg && (msg.includes('Extension context invalidated') || msg.includes('sendMessage'))) {
            // 拡張機能がリロードされた場合は、定期チェックを停止してページリフレッシュを推奨
            stopPeriodicCheck();
            await logInfo('Extension reloaded - page refresh needed', {}, 'extractor');
        } else {
            await logWarn('Failed to report valid visit', { error: msg }, ErrorCode.API_REQUEST_FAILURE, 'extractor');
        }
    }
}

// showPrivacyConfirmDialog is in ./privacyDialog.ts — re-export for backward compat
export { showPrivacyConfirmDialog } from './privacyDialog.js';

/**
 * Schedule the next periodic check using requestIdleCallback when available,
 * falling back to a short setTimeout. This avoids the fixed 1s polling of
 * setInterval and only runs while the page is visible.
 */
function scheduleNextCheck(): void {
    if (pageState.isValidVisitReported || document.hidden) return;

    if (typeof window.requestIdleCallback === 'function') {
        pageState.checkIntervalId = window.requestIdleCallback(() => {
            pageState.checkIntervalId = null;
            updateMaxScroll();
            if (!pageState.isValidVisitReported && !document.hidden) {
                scheduleNextCheck();
            }
        }, { timeout: 2000 });
    } else {
        pageState.checkIntervalId = window.setTimeout(() => {
            pageState.checkIntervalId = null;
            updateMaxScroll();
            if (!pageState.isValidVisitReported && !document.hidden) {
                scheduleNextCheck();
            }
        }, 1000);
    }
}

/**
 * 定期実行を開始する
 * 【機能概要】: ブラウザがアイドル時に条件チェックを実行するループを開始する
 * 【パフォーマンス】: requestIdleCallback + visibilitychange により不要なCPU使用を回避
 * 🟢
 */
function startPeriodicCheck(): void {
    stopPeriodicCheck();
    scheduleNextCheck();
}

/**
 * 定期実行を停止する
 * 【機能概要】: 条件チェックのタイマーを停止する
 * 【用途】:
 *   - 条件満了時の自動停止
 *   - ページ離脱時のクリーンアップ
 *   - タブ非表示時の一時停止
 * 🟢
 */
function stopPeriodicCheck(): void {
    if (pageState.checkIntervalId !== null) {
        if (typeof window.cancelIdleCallback === 'function') {
            window.cancelIdleCallback(pageState.checkIntervalId);
        } else {
            window.clearTimeout(pageState.checkIntervalId);
        }
        pageState.checkIntervalId = null;
    }
}

/**
 * 初期化処理
 * 【機能概要】: 設定の読み込みとイベントリスナーの登録
 * 🟢
 */
export async function init(): Promise<void> {
    // 設定をロード（非同期で待機）
    await loadSettings();

    // 【イベントリスナー登録】: スクロールイベントを監視（throttle化でパフォーマンス向上）
    // プログラムによるスクロール（element.scrollTo など）は isTrusted=false のため無視し、
    // ユーザー操作のみで記録判定を進める（PBI-05）
    const throttledUpdateMaxScroll = throttle(updateMaxScroll);
    window.addEventListener('scroll', (event: Event) => {
        if (!event.isTrusted) return;
        throttledUpdateMaxScroll();
    }, { passive: true });

    // 【定期実行】: 1秒ごとに条件をチェック
    startPeriodicCheck();

    // 【クリーンアップ】: ページ離脱時に定期実行を停止
    window.addEventListener('beforeunload', stopPeriodicCheck);

    // 【パフォーマンス最適化】: タブが非表示の場合は定期実行を停止
    // Page Visibility APIを使用して、バックグラウンドタブでの不要な処理を回避
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopPeriodicCheck();
        } else if (!pageState.isValidVisitReported) {
            // タブが表示され、まだ記録が行われていない場合は再開
            startPeriodicCheck();
        }
    });

    // E2Eテスト用: 初期化完了を data-ow-test-state 属性で通知
    if (document.documentElement.hasAttribute('data-ow-e2e-test')) {
        document.documentElement.setAttribute('data-ow-test-state', JSON.stringify({
            maxScrollPercentage: pageState.maxScrollPercentage,
            isValidVisitReported: pageState.isValidVisitReported,
            startTime: pageState.startTime,
            minVisitDuration: pageState.minVisitDuration,
            minScrollDepth: pageState.minScrollDepth,
            duration: 0,
        }));
    }
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