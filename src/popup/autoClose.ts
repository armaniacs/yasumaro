// Auto-close functionality after successful recording

import { getScreenState } from './screenState.js';
import { getMessage } from './i18n.js';

/**
 * 【定数定義群】: タイマー関連の各種設定値
 * 【設計方針】: 定数をまとめて定義し、保守性と可読性を向上
 * 【パフォーマンス】: 適切な遅延時間と更新間隔により、ユーザー体験を最適化
 */
const DEFAULT_AUTO_CLOSE_DELAY_MS = 2000;
const COUNTDOWN_UPDATE_INTERVAL_MS = 1000;
const COUNTDOWN_START_VALUE = 3;

/**
 * 【動的import使用に関する説名】
 * 【理由】: 現在の実装では、autoClose.jsからnavigation.jsではなくscreenState.jsに画面状態管理の関数をimportするため、
 * 循環参照問題が解消されています。navigation.jsはautoClose.jsをimportしますが、autoClose.jsはscreenState.jsのみをimportします。
 * 【依存関係図】:
 *   - navigation.js → screenState.js
 *   - navigation.js → autoClose.js
 *   - autoClose.js → screenState.js
 *   - 循環参照なし
 */

/**
 * 【タイマーID管理変数】: モジュールスコープでタイマー管理
 * 【責任分離】: タイマー管理はautoClose.jsの責務
 * 【テスト容易性】: 外部からclearAutoCloseTimer経由でクリア可能
 */
let autoCloseTimerId: NodeJS.Timeout | number | null = null;
let countdownIntervalId: NodeJS.Timeout | number | null = null;

/**
 * 【機能概要】: 自動クローズタイマーを起動
 * 【実装方針】: メイン画面では指定された遅延時間後にwindow.close()を呼び出すタイマーを設定
 * 【改善内容】:
 *   - 画面状態チェックを最初に行い、不要なタイマー設定を回避
 *   - 既存タイマーのクリア処理を明確化
 * 【テスト対応】:
 *   - 「startAutoCloseTimerでタイマーが起動し、指定時間後にwindow.closeが呼ばれる」
 *   - 「設定画面では自動クローズタイマーが起動しない」
 *   - 「連続してタイマーを設定すると前のタイマーがキャンセルされる」
 * 🟢 要求定義（tdd-requirements.md 110-114行目、機能制約「画面依存」）
 * 【リファクタ改善】:
 *   - screenState.jsからのimportにより、循環参照問題を完全解消
 *   - モジュールの責任範囲を明確化（autoClose.jsはタイマー管理のみに責任を持つ）
 */
export function startAutoCloseTimer(delayMs: number = DEFAULT_AUTO_CLOSE_DELAY_MS): void {
  // 【入力値検証】: 設定画面では自動クローズしない
  // 【早期リターン】: 条件不成立時は即座に関数を抜けることで、処理効率を向上
  if (getScreenState() !== 'main') {
    return;
  }

  // 【タイマー管理】: 既存のタイマーをクリア
  // 【理由】: 連続記録時に前のタイマーが残らないようにするため
  // 【メモリ管理】: 古いタイマーを解放し、メモリリークを防止
  clearAutoCloseTimer();

  // 【タイマー設定】: 指定された遅延時間後にwindow.closeを呼び出す
  // 【エラーハンドリング】: window.close失敗時はサイレントフェール
  autoCloseTimerId = setTimeout(() => {
    try {
      // 【実処理実行】: ポップアップを閉じる
      window.close();
    } catch (error) {
      // 【エラー捕捉】: window.closeがブラウザでブロックされた場合
      // 【サイレントフェール】: 例外をスローせずに処理を継続
      // 【ユーザビリティ】: エラーメッセージ表示によるユーザー体験の悪化を回避
    }
  }, delayMs);
}

/**
 * 【機能概要】: 自動クローズタイマーをキャンセル
 * 【実装方針】:
 *   - setTimeoutで設定されたタイマーをクリア
 *   - setIntervalで設定されたカウントダウンをクリア
 * 【設計上の改善】:
 *   - 明確な条件分岐により、nullチェックを自明にする
 *   - IDをnullに戻すことで、次回のclearAutoCloseTimer呼び出しでの不要な処理を回避
 * 【テスト対応】:
 *   - 「clearAutoCloseTimerでタイマーがキャンセルされる」
 *   - 「カウントダウン中に設定画面へ遷移するとタイマーがキャンセルされる」
 * 🟢 要求定義（tdd-requirements.md 166-167行目、連続記録時のタイマー管理）
 */
export function clearAutoCloseTimer(): void {
  // 【タイマークリア】: setTimeoutで設定されたタイマーを解除
  if (autoCloseTimerId !== null) {
    clearTimeout(autoCloseTimerId);
    autoCloseTimerId = null; // 【状態リセット】: タイマーIDを初期値に戻す
  }

  // 【カウントダウンクリア】: setIntervalで設定されたカウントダウンを解除
  if (countdownIntervalId !== null) {
    clearInterval(countdownIntervalId);
    countdownIntervalId = null; // 【状態リセット】: インターバルIDを初期値に戻す
  }
}

/**
 * Show countdown display
 * @param {HTMLElement} statusDiv Status display DOM element
 */
export function showCountdown(statusDiv: HTMLElement): void {
  // Initialize countdown value to start value
  let count = COUNTDOWN_START_VALUE;

  // Show initial countdown value
  statusDiv.textContent = getMessage('countdownNumber', { count: count.toString() });

  // Start countdown update at 1000ms intervals
  countdownIntervalId = setInterval(() => {
    count--;

    if (count > 0) {
      // Still counting down, show number
      statusDiv.textContent = getMessage('countdownNumber', { count: count.toString() });
    } else {
      // Countdown complete message
      statusDiv.textContent = getMessage('autoClosing');

      // End interval to prevent memory leaks
      if (countdownIntervalId !== null) {
        clearInterval(countdownIntervalId as any);
        countdownIntervalId = null; // Reset interval ID to initial value
      }
    }
  }, COUNTDOWN_UPDATE_INTERVAL_MS);
}