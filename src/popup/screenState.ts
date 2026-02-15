// Screen state management module

/**
 * 【画面状態定数値】: 画面状態の正当な値を定義 🟢
 * 🟢 要求定義（tdd-requirements.md 49-52行目、screenState型定義）
 * 【再利用性**: 他のモジュールからも参照される可能性を考慮
 */
const SCREEN_STATES = Object.freeze({
  MAIN: 'main',
  SETTINGS: 'settings'
} as const);

export type ScreenState = typeof SCREEN_STATES[keyof typeof SCREEN_STATES];

/**
 * 【定数定義】: 画面状態のデフォルト値を'main'に設定 🟢
 * 🟢 要求定義（tdd-requirements.md 32-33行目、初期画面がメイン画面）
 * 【定数参照】: SCREEN_STATES.MAINから値を取得
 */
const DEFAULT_SCREEN_STATE: ScreenState = SCREEN_STATES.MAIN;

/**
 * 【変数初期化】: 画面状態をモジュールスコープで保持（テストでリセット可能にする） 🟢
 * 【責任境界】: 画面状態の管理はscreenState.jsの責務
 * 【設計方針】: グローバルではなくモジュールスコープで管理することで複数ポップアップの並行実行を想定
 */
let currentScreen: ScreenState = DEFAULT_SCREEN_STATE;

/**
 * 【機能概要】: 現在の画面状態を取得
 * 【設計方針】: シンプルなgetterを維持、将来のログ等の出力に対応
 * @returns {'main' | 'settings'} 現在の画面状態
 * 🟢 要求定義（tdd-requirements.md 49-52行目、screenState型定義）
 */
export function getScreenState(): ScreenState {
  return currentScreen;
}

/**
 * 【機能概要】: 画面状態を設定
 * 【設計方針】: シンプルなsetterを維持、将来の状態遷移ロギングの追加対応可
 * @param {'main' | 'settings'} state 設定する画面状態
 * 🟢 要求定義（tdd-requirements.md 49-52行目、screenState型定義）
 */
export function setScreenState(state: ScreenState): void {
  currentScreen = state;
}

/**
 * 【機能概要】: 画面状態を初期値に戻す
 * 【設計方針】: モジュール初期化時やテストクリーンアップ時に使用
 * 🟢 要求定義に基づき初期状態を'main'とするアプローチ
 */
export function clearScreenState(): void {
  currentScreen = DEFAULT_SCREEN_STATE;
}

/**
 * 【画面状態定数オブジェクトの取得】: 他モジュールから定数を参照可能にする 🟢
 * 【改善内容】: magic stringを避けるため、定数値を型定義として公開
 * 【再利用性】: navigation.js等で画面状態設定時に使用
 */
export { SCREEN_STATES };