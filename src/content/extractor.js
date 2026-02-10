/**
 * extractor.js
 * 【機能概要】: Webページのコンテンツを抽出し、スクロール深度や訪問時間を監視するコンテントスクリプト
 * 【設計方針】: ページの読み込み後に設定を取得し、条件を満たした場合に自動記録を実行
 * 【監視対象】:
 *   - 最小訪問時間（デフォルト: 5秒）
 *   - 最小スクロール深度（デフォルト: 50%）
 * 🟢
 */

// 【設定定数】: デフォルト値の定義
const DEFAULT_MIN_VISIT_DURATION = 5; // 秒
const DEFAULT_MIN_SCROLL_DEPTH = 50;   // パーセンテージ

// 【状態管理】: スクリプトの実行状態を管理
let minVisitDuration = DEFAULT_MIN_VISIT_DURATION;
let minScrollDepth = DEFAULT_MIN_SCROLL_DEPTH;
let startTime = Date.now();
let maxScrollPercentage = 0;
let isValidVisitReported = false;
let checkIntervalId = null; // 【パフォーマンス向上】: 定期実行のIDを管理し、条件満了後に停止

// 【リトライヘルパー】: Service Worker通信のリトライ機能
import { createSender } from '../utils/retryHelper.js';

// モジュールレベルでリトライ付き送信者を作成
const messageSender = createSender({ maxRetries: 2, initialDelay: 50 });

/**
 * コンテンツを抽出する共通関数
 * 【機能概要】: ページの本文テキストを抽出し、空白文字を正規化する
 * 【抽出範囲】: document.body.innerText（最大10,000文字）
 * 【処理内容】:
 *   1. bodyのテキストを抽出
 *   2. 連続する空白文字を単一のスペースに置換
 *   3. 前後の空白を削除
 *   4. 最大10,000文字で切り詰め
 * 🟢
 * @returns {string} - 抽出されたコンテンツ（最大10,000文字）
 */
function extractPageContent() {
    return document.body.innerText
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 10000);
}

/**
 * 設定をロードする
 * 【機能概要】: chrome.storage.localから最小訪問時間と最小スクロール深度を読み込む
 * 【読み込みタイミング】: スクリプト読み込み時（Chrome拡張のコンテントスクリプト読み込み時）
 * 【デフォルト値】: MIN_VISIT_DURATION=5秒, MIN_SCROLL_DEPTH=50%
 * 🟢
 */
function loadSettings() {
    chrome.storage.local.get(['min_visit_duration', 'min_scroll_depth'], (result) => {
        if (result.min_visit_duration) minVisitDuration = parseInt(result.min_visit_duration, 10);
        if (result.min_scroll_depth) minScrollDepth = parseInt(result.min_scroll_depth, 10);
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
function checkVisitConditions() {
    if (isValidVisitReported) return;

    const duration = (Date.now() - startTime) / 1000;

    // DEBUG LOG: 状態のデバッグログ（必要に応じて有効化）
    // console.log(`Status: Duration=${duration.toFixed(1)}s, MaxScroll=${maxScrollPercentage.toFixed(1)}%`);

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
 * 最大スクロール深度を更新する
 * 【機能概要】: 現在のスクロール位置からスクロール深度（%）を計算し、最大値を更新
 * 【計算式】: (scrollY / (scrollHeight - innerHeight)) * 100
 * 【エラーハンドリング】: 分母が0以下の場合は計算をスキップ（ページが空の場合など）
 * 🟢
 */
function updateMaxScroll() {
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
async function reportValidVisit() {
    isValidVisitReported = true;

    const content = extractPageContent();

    try {
        const response = await messageSender.sendMessageWithRetry({
            type: 'VALID_VISIT',
            payload: {
                content: content
            }
        });

        // レスポンスの成功フラグをチェック
        if (response && !response.success) {
            console.error("Background Worker Error:", response.error);
        }
    } catch (error) {
        // 全てのリトライが失敗した場合
        console.warn("Failed to report valid visit:", error.message);
    }
}

/**
 * 定期実行を開始する
 * 【機能概要】: 1秒ごとに条件チェックを実行するタイマーを開始する
 * 【パフォーマンス】: 条件満了後にタイマーが停止されるため、不要なCPU使用を回避
 * 🟢
 */
function startPeriodicCheck() {
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
function stopPeriodicCheck() {
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
function init() {
    loadSettings();

    // 【イベントリスナー登録】: スクロールイベントを監視
    window.addEventListener('scroll', updateMaxScroll);

    // 【定期実行】: 1秒ごとに条件をチェック
    startPeriodicCheck();

    // 【クリーンアップ】: ページ離脱時に定期実行を停止
    window.addEventListener('beforeunload', stopPeriodicCheck);
}

// 【ポップアップからのメッセージハンドラ】: 手動コンテンツ取得要求に応答
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_CONTENT') {
        const content = extractPageContent();
        sendResponse({ content });
    }
    return true;
});

// 【初期化実行】
init();