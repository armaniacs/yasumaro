// Navigation functions for popup UI

import { getScreenState, setScreenState, SCREEN_STATES } from './screenState.js';
import { clearAutoCloseTimer } from './autoClose.js';
import { setHtmlLangAndDir } from './i18n.js';

/**
 * 【機能概要】: メイン画面を表示し、設定画面を非表示にする
 * 【設計方針】: DOM操作と画面状態更新を明確に分離、可読性向上
 * 各操作の責任が明確になるようDOM操作後すぐ状態更新
 * 🟢 要求定義（tdd-requirements.md 32-33行目、初期画面がメイン画面）
 */
export function showMainScreen(): void {
  // 【DOM操作】: 画面表示の切り替え 🟢
  // 【設計方針】: DOM操作の条件チェックで安全に処理
  const mainScreen = document.getElementById('mainScreen');
  const settingsScreen = document.getElementById('settingsScreen');
  const menuBtn = document.getElementById('menuBtn');

  if (mainScreen) mainScreen.style.display = 'block';
  if (settingsScreen) settingsScreen.style.display = 'none';

  // 【アクセシビリティ改善】メニューボタンの aria-expanded 属性を設定
  if (menuBtn) {
    menuBtn.setAttribute('aria-expanded', 'false');
  }

  // 【画面状態更新】: メイン画面に切り替わったことを記録
  // 【設計方針】: DOM操作完了後に画面状態を更新して一貫性を保証
  setScreenState(SCREEN_STATES.MAIN);
}

/**
 * 【機能概要】: 設定画面を表示し、メイン画面を非表示にする
 * 【改善内容】: 設定画面への切り替え時に自動クローズタイマーをクリア
 * 【設計方針】:
 *   - DOM操作と画面状態更新を明確に分離
 *   - 設定画面への遷移時は自動クローズ機能が不要になるためタイマーをクリア
 *   - 循環参照回避のためにscreenState.js分割を実施
 * 【ユーザビリティ向上】: 設定作業時にいきなりポップアップが閉じないようにする
 * 【メモリ管理】: タイマーのクリア漏れによるメモリリーク防止
 * 【リファクタ改善】:
 *   - screenState.js 即時importにより、関数内importによる構文エラーを回避
 *   - navigation.js → autoClose.js の一方向依存を明確化
 * 🟢 要求定義（tdd-requirements.md 169-174行目、画面遷移時のタイマーキャンセル）
 * 🟡 設定上の妥当な推測: カウントダウン完了前の画面遷移に対してタイマーを停止することは合理的
 */
/**
 * Open the SQLite history dashboard in a new tab.
 */
export function openHistory(): void {
  console.log('[Navigation] openHistory called - opening SQLite history');

  clearAutoCloseTimer();

  const historyUrl = chrome.runtime.getURL('options.html?tab=sqlite-history');
  chrome.tabs.create({ url: historyUrl });

  window.close();
}

export function showSettingsScreen(): void {
  console.log('[Navigation] showSettingsScreen called - opening dashboard');

  // 【タイマークリア】: ダッシュボードを開く前に自動クローズタイマーを解放
  clearAutoCloseTimer();

  // 【ダッシュボード遷移】: 設定を新しいタブのダッシュボードページで開く
  const dashboardUrl = chrome.runtime.getURL('options.html');
  chrome.tabs.create({ url: dashboardUrl });

  // ポップアップを閉じる
  window.close();
}

/**
 * 【機能概要】: ポップアップの初期化処理
 * 【設計方針】:
 *   - DOM要素取得とイベントリスナー設定を分離して可読性向上
 *   - 各操作の責任が明確
 *   - デフォルトでメイン画面を表示
 * 🟢 要求定義（tdd-requirements.md 32-33行目、初期画面がメイン画面）
 */
export function init(): void {
  console.log('[Navigation] Initializing navigation...');

  // 【アクセシビリティ改善】htmlのlangとdir属性をユーザーロケールに基づいて設定
  setHtmlLangAndDir();

  // 【DOM要素キャプチャ】: イベント設定用に要素を取得 🟢
  // 【設計方針】: 毎回のDOMクエリを避けるために先に取得
  const menuBtn = document.getElementById('menuBtn');
  const backBtn = document.getElementById('backBtn');

  console.log('[Navigation] Menu button found:', !!menuBtn);
  console.log('[Navigation] Back button found:', !!backBtn);

  // 【イベントリスナー設定】: ボタンクリック時の画面遷移を設定 🟢
  if (menuBtn) {
    menuBtn.addEventListener('click', showSettingsScreen);

    // Open SQLite History dashboard
    const historyBtn = document.getElementById('historyBtn');
    if (historyBtn) {
      historyBtn.addEventListener('click', openHistory);
    }
    console.log('[Navigation] Event listener attached to menu button');
  } else {
    // console.error('[Navigation] Menu button not found! Cannot attach event listener.');
  }

  if (backBtn) {
    backBtn.addEventListener('click', showMainScreen);
    console.log('[Navigation] Event listener attached to back button');
  }

  // 【初期表示】: デフォルト画面を表示 🟢
  showMainScreen();
  console.log('[Navigation] Initialization complete');
}