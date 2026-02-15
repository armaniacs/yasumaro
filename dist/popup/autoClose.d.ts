/**
 * 【機能概要】: 自動クローズタイマーを起動
 * 【実装方針】: メイン画面では2000ms後にwindow.close()を呼び出すタイマーを設定
 * 【改善内容】:
 *   - 画面状態チェックを最初に行い、不要なタイマー設定を回避
 *   - 既存タイマーのクリア処理を明確化
 * 【テスト対応】:
 *   - 「startAutoCloseTimerでタイマーが起動し、2000ms後にwindow.closeが呼ばれる」
 *   - 「設定画面では自動クローズタイマーが起動しない」
 *   - 「連続してタイマーを設定すると前のタイマーがキャンセルされる」
 * 🟢 要求定義（tdd-requirements.md 110-114行目、機能制約「画面依存」）
 * 🔴 完全性要確認: autoClose.jsからnavigation.jsへのimport依存を削除
 * 【リファクタ改善】:
 *   - screenState.jsからのimportにより、循環参照問題を完全解消
 *   - モジュールの責任範囲を明確化（autoClose.jsはタイマー管理のみに責任を持つ）
 */
export declare function startAutoCloseTimer(): void;
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
export declare function clearAutoCloseTimer(): void;
/**
 * Show countdown display
 * @param {HTMLElement} statusDiv Status display DOM element
 */
export declare function showCountdown(statusDiv: HTMLElement): void;
//# sourceMappingURL=autoClose.d.ts.map