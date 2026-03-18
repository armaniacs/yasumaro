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
import { reasonToStatusCode, statusCodeToMessageKey } from '../utils/privacyStatusCodes.js';
import { extractMainContent } from '../utils/contentExtractor.js';

// StorageKeys（content script で使用するもののみ）
const CONTENT_STRIP_HARD_ENABLED = 'content_strip_hard_enabled';
const CONTENT_STRIP_KEYWORD_ENABLED = 'content_strip_keyword_enabled';
const CONTENT_STRIP_KEYWORDS = 'content_strip_keywords';

// 【設定定数】: デフォルト値の定義
const DEFAULT_MIN_VISIT_DURATION = 5; // 秒
const DEFAULT_MIN_SCROLL_DEPTH = 50;   // パーセンテージ

// 【状態管理】: スクリプトの実行状態を管理
let minVisitDuration = DEFAULT_MIN_VISIT_DURATION;
let minScrollDepth = DEFAULT_MIN_SCROLL_DEPTH;
let startTime = Date.now();
let maxScrollPercentage = 0;
let isValidVisitReported = false;
let checkIntervalId: number | NodeJS.Timeout | null = null; // 【パフォーマンス向上】: 定期実行のIDを管理し、条件満了後に停止

// 【クレンジング設定】: コンテンツクレンジングの有効化状態を管理
let contentStripHardEnabled = true;
let contentStripKeywordEnabled = true;
let contentStripKeywords: string[] = ['balance', 'account', 'meisai', 'login', 'card-number', 'keiyaku'];

// 【クレンジング情報】: 直近の抽出で適用されたクレンジング情報を保持
export let lastCleansedReason: 'hard' | 'keyword' | 'both' | 'none' = 'none';
export let lastCleanseStats: { hardStripRemoved: number; keywordStripRemoved: number; totalRemoved: number } = {
    hardStripRemoved: 0,
    keywordStripRemoved: 0,
    totalRemoved: 0
};
// 【バイト数情報】: 直近の抽出で適用されたバイト数情報を保持
export let lastByteStats: { originalBytes: number; cleansedBytes: number } = {
    originalBytes: 0,
    cleansedBytes: 0
};

// モジュールレベルでリトライ付き送信者を作成
const messageSender = createSender({ maxRetries: 2, initialDelay: 50 });

/**
 * コンテンツを抽出する共通関数
 * 【機能概要】: ページの本文テキスト（メインコンテンツ）を抽出し、空白文字を正規化する
 * 【抽出範囲】: メインコンテンツ（ナビゲーション、ヘッダー等除外、最大10,000文字）
 * 【処理内容】:
 *   1. メインコンテンツ（article/mainタグ等優先）を抽出
 *   2. 連続する空白文字を単一のスペースに置換
 *   3. 前後の空白を削除
 *   4. 最大10,000文字で切り詰め
 * 【改善点】: Readabilityアルゴリズムでナビゲーション等のノイズを除外
 * 【クレンジング】: 設定に従って機密情報を含む要素を削除
 * 🟢
 * @returns {string} - 抽出されたコンテンツ（最大10,000文字）
 */
function extractPageContent(): string {
    const cleanseOptions = {
        cleanseEnabled: contentStripHardEnabled || contentStripKeywordEnabled,
        hardStripEnabled: contentStripHardEnabled,
        keywordStripEnabled: contentStripKeywordEnabled,
        keywords: contentStripKeywords,
        returnInfo: true
    };
    const result = extractMainContent(10000, cleanseOptions);
    // クレンジング情報を保存
    if (typeof result === 'object' && 'cleansedReason' in result) {
        lastCleansedReason = result.cleansedReason || 'none';
        lastCleanseStats = {
            hardStripRemoved: result.hardStripRemoved ?? 0,
            keywordStripRemoved: result.keywordStripRemoved ?? 0,
            totalRemoved: result.totalRemoved ?? 0
        };
        // バイト数情報を保存
        lastByteStats = {
            originalBytes: result.originalBytes ?? 0,
            cleansedBytes: result.cleansedBytes ?? 0
        };
    }
    return typeof result === 'string' ? result : result.content;
}

/**
 * 設定をロードする
 * 【機能概要】: chrome.storage.localから設定を読み込む
 * 【読み込みタイミング】: スクリプト読み込み時（Chrome拡張のコンテントスクリプト読み込み時）
 * 【デフォルト値】: MIN_VISIT_DURATION=5秒, MIN_SCROLL_DEPTH=50%
 * 【マイグレーション対応】: settingsキー下から値を取得（マイグレーション後の構造に対応）
 * 🟢
 */
function loadSettings(): void {
    chrome.storage.local.get([
        'min_visit_duration',
        'min_scroll_depth',
        CONTENT_STRIP_HARD_ENABLED,
        CONTENT_STRIP_KEYWORD_ENABLED,
        CONTENT_STRIP_KEYWORDS
    ], (result: { [key: string]: any }) => {
        if (result.min_visit_duration !== undefined) {
            minVisitDuration = parseInt(String(result.min_visit_duration), 10);
        }
        if (result.min_scroll_depth !== undefined) {
            minScrollDepth = parseInt(String(result.min_scroll_depth), 10);
        }
        // クレンジング設定を取得
        if (result[CONTENT_STRIP_HARD_ENABLED] !== undefined) {
            contentStripHardEnabled = result[CONTENT_STRIP_HARD_ENABLED];
        }
        if (result[CONTENT_STRIP_KEYWORD_ENABLED] !== undefined) {
            contentStripKeywordEnabled = result[CONTENT_STRIP_KEYWORD_ENABLED];
        }
        if (result[CONTENT_STRIP_KEYWORDS] !== undefined && Array.isArray(result[CONTENT_STRIP_KEYWORDS])) {
            contentStripKeywords = result[CONTENT_STRIP_KEYWORDS];
        }
    });
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
    if (isValidVisitReported) return;

    const duration = (Date.now() - startTime) / 1000;

    // DEBUG LOG: 状態のデバッグログ
    console.log(`[OWeave] Status: Duration=${duration.toFixed(1)}s, MaxScroll=${maxScrollPercentage.toFixed(1)}%, threshold=${minVisitDuration}s/${minScrollDepth}%`);

    // 【条件判定】: 時間とスクロール深度の両方の条件を満たす場合に記録を実行
    if (duration >= minVisitDuration && maxScrollPercentage >= minScrollDepth) {
        reportValidVisit();
        // 【パフォーマンス向上】: 条件満了後に定期実行を停止
        if (checkIntervalId) {
            clearInterval(checkIntervalId);
            checkIntervalId = null;
        }
    }
}

/**
 * Throttle function using requestAnimationFrame
 * 【機能概要】: 関数呼び出しをフレーム単位で抑制し、高速スクロール時の負荷を軽減
 * @param fn - Throttle対象の関数
 * @returns Throttle化された関数
 */
function throttle<T extends (...args: any[]) => void>(fn: T): T {
    let lastCall = 0;
    let rafId: number | null = null;
    let lastArgs: Parameters<T> | null = null;

    return ((...args: Parameters<T>) => {
        lastArgs = args;
        const now = performance.now();

        // 既にRAFがスケジュールされている場合は引数だけ更新
        if (rafId !== null) {
            return;
        }

        // 前回の呼び出しから十分時間が経過しているか確認
        const timeSinceLastCall = now - lastCall;
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
    if (scrollPercentage > maxScrollPercentage) {
        maxScrollPercentage = scrollPercentage;
        // console.log(`New Max Scroll: ${maxScrollPercentage.toFixed(1)}%`);
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
    isValidVisitReported = true;
    console.log('[OWeave] reportValidVisit: sending VALID_VISIT');

    const content = extractPageContent();

    try {
        const response: any = await messageSender.sendMessageWithRetry({
            type: 'VALID_VISIT',
            payload: {
                content: content,
                originalBytes: lastByteStats.originalBytes,
                cleansedBytes: lastByteStats.cleansedBytes
            }
        });
        console.log('[OWeave] VALID_VISIT response:', JSON.stringify(response));

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
                    } catch (retryError: any) {
                        console.error("Failed to force save private page:", retryError.message);
                    }
                }
                return;
            }

            console.error("Background Worker Error:", response.error);
        }
    } catch (error: any) {
        // 全てのリトライが失敗した場合
        if (error.message && (error.message.includes('Extension context invalidated') || error.message.includes('sendMessage'))) {
            // 拡張機能がリロードされた場合は、定期チェックを停止してページリフレッシュを推奨
            if (checkIntervalId) {
                clearInterval(checkIntervalId);
                checkIntervalId = null;
            }
            console.info("Extension was reloaded. Please refresh this page to resume history recording.");
        } else {
            console.warn("Failed to report valid visit:", error.message);
        }
    }
}

/**
 * プライバシー懸念ページの確認ダイアログをページ上に表示する。
 * ブラウザ標準の confirm() を使わず Shadow DOM でロゴ・ステータスコード付きの
 * カスタムダイアログを表示する。
 */
function showPrivacyConfirmDialog(statusCode: string, reasonLabel: string): Promise<boolean> {
    return new Promise((resolve) => {
        const iconUrl = chrome.runtime.getURL('icons/icon48.png');
        const title = chrome.i18n.getMessage('notifyPrivacyConfirmTitle') || 'Obsidian Weave';
        const bodyText = chrome.i18n.getMessage('privacyDialogBody', [reasonLabel])
            || `このページにはプライバシー懸念があります（${reasonLabel}）。それでも保存しますか？`;
        const saveLabel = chrome.i18n.getMessage('notifyPrivacyConfirmSave') || '保存する';
        const cancelLabel = chrome.i18n.getMessage('cancel') || 'キャンセル';
        const statusLabel = chrome.i18n.getMessage('privacyDialogStatusLabel') || '検出コード';

        // ホスト要素
        const host = document.createElement('div');
        host.id = 'osh-privacy-confirm-host';
        host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; top: 0; left: 0; width: 100%; height: 100%;';
        const shadow = host.attachShadow({ mode: 'closed' });

        // Constructable Stylesheets を使用（CSP style-src 'self' に準拠）
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(`
            .overlay {
                position: fixed; inset: 0;
                background: rgba(0,0,0,0.45);
                display: flex; align-items: center; justify-content: center;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            }
            .dialog {
                background: #fff;
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.22);
                padding: 24px 28px 20px;
                max-width: 380px;
                width: 90vw;
                box-sizing: border-box;
            }
            .header {
                display: flex; align-items: center; gap: 10px;
                margin-bottom: 14px;
            }
            .header img { width: 28px; height: 28px; flex-shrink: 0; }
            .header span {
                font-size: 15px; font-weight: 700; color: #1a1a1a;
            }
            .body { font-size: 14px; color: #333; line-height: 1.6; margin-bottom: 14px; }
            .status {
                display: inline-flex; align-items: center; gap: 6px;
                background: #f3f4f6; border-radius: 6px;
                padding: 4px 10px; font-size: 12px; color: #555;
                margin-bottom: 18px;
            }
            .status-code { font-family: monospace; font-weight: 700; color: #d97706; }
            .buttons { display: flex; gap: 10px; justify-content: flex-end; }
            .btn {
                padding: 8px 18px; border-radius: 7px; font-size: 14px;
                cursor: pointer; border: none; font-weight: 600;
            }
            .btn-cancel { background: #f3f4f6; color: #555; }
            .btn-cancel:hover { background: #e5e7eb; }
            .btn-save { background: #4f46e5; color: #fff; }
            .btn-save:hover { background: #4338ca; }
        `);
        shadow.adoptedStyleSheets = [sheet];

        // HTMLはスタイルなしで構築（XSS対策: テキストはtextContentで設定）
        shadow.innerHTML = `
            <div class="overlay">
                <div class="dialog" role="dialog" aria-modal="true">
                    <div class="header">
                        <img src="${iconUrl}" alt="">
                        <span id="osh-title"></span>
                    </div>
                    <div class="body" id="osh-body"></div>
                    <div class="status">
                        <span id="osh-status-label"></span>
                        <span class="status-code" id="osh-status-code"></span>
                        <span id="osh-reason"></span>
                    </div>
                    <div class="buttons">
                        <button class="btn btn-cancel" id="osh-cancel"></button>
                        <button class="btn btn-save" id="osh-save"></button>
                    </div>
                </div>
            </div>
        `;

        // テキストはtextContentで安全に設定
        const setText = (id: string, text: string) => {
            const el = shadow.getElementById(id);
            if (el) el.textContent = text;
        };
        setText('osh-title', title);
        setText('osh-body', bodyText);
        setText('osh-status-label', `${statusLabel}:`);
        setText('osh-status-code', statusCode);
        setText('osh-reason', `— ${reasonLabel}`);
        setText('osh-cancel', cancelLabel);
        setText('osh-save', saveLabel);

        const cleanup = (result: boolean) => {
            host.remove();
            resolve(result);
        };

        shadow.getElementById('osh-save')?.addEventListener('click', () => cleanup(true));
        shadow.getElementById('osh-cancel')?.addEventListener('click', () => cleanup(false));
        // オーバーレイクリックでキャンセル
        shadow.querySelector('.overlay')?.addEventListener('click', (e) => {
            if (e.target === shadow.querySelector('.overlay')) cleanup(false);
        });

        document.body.appendChild(host);
        // フォーカスをキャンセルボタンへ
        setTimeout(() => (shadow.getElementById('osh-cancel') as HTMLElement)?.focus(), 0);
    });
}

/**
 * 定期実行を開始する
 * 【機能概要】: 1秒ごとに条件チェックを実行するタイマーを開始する
 * 【パフォーマンス】: 条件満了後にタイマーが停止されるため、不要なCPU使用を回避
 * 🟢
 */
function startPeriodicCheck(): void {
    if (checkIntervalId) {
        clearInterval(checkIntervalId);
    }
    checkIntervalId = setInterval(checkVisitConditions, 1000);
}

/**
 * 定期実行を停止する
 * 【機能概要】: 条件チェックのタイマーを停止する
 * 【用途】:
 *   - 条件満了時の自動停止
 *   - ページ離脱時のクリーンアップ
 * 🟢
 */
function stopPeriodicCheck(): void {
    if (checkIntervalId) {
        clearInterval(checkIntervalId);
        checkIntervalId = null;
    }
}

/**
 * 初期化処理
 * 【機能概要】: 設定の読み込みとイベントリスナーの登録
 * 🟢
 */
function init(): void {
    loadSettings();

    // 【イベントリスナー登録】: スクロールイベントを監視（throttle化でパフォーマンス向上）
    const throttledUpdateMaxScroll = throttle(updateMaxScroll);
    window.addEventListener('scroll', throttledUpdateMaxScroll);

    // 【定期実行】: 1秒ごとに条件をチェック
    startPeriodicCheck();

    // 【クリーンアップ】: ページ離脱時に定期実行を停止
    window.addEventListener('beforeunload', stopPeriodicCheck);

    // 【パフォーマンス最適化】: タブが非表示の場合は定期実行を停止
    // Page Visibility APIを使用して、バックグラウンドタブでの不要な処理を回避
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopPeriodicCheck();
        } else if (!isValidVisitReported) {
            // タブが表示され、まだ記録が行われていない場合は再開
            startPeriodicCheck();
        }
    });
}

// 【ポップアップからのメッセージハンドラ】: 手動コンテンツ取得要求に応答
chrome.runtime.onMessage.addListener((message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
    if (message.type === 'GET_CONTENT') {
        const content = extractPageContent();
        sendResponse({ content, cleansedReason: lastCleansedReason, cleanseStats: lastCleanseStats });
    }
    return true;
});

// 【初期化実行】
init();