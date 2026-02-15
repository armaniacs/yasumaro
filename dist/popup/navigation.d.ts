/**
 * 【機能概要】: メイン画面を表示し、設定画面を非表示にする
 * 【設計方針】: DOM操作と画面状態更新を明確に分離、可読性向上
 * 各操作の責任が明確になるようDOM操作後すぐ状態更新
 * 🟢 要求定義（tdd-requirements.md 32-33行目、初期画面がメイン画面）
 */
export declare function showMainScreen(): void;
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
export declare function showSettingsScreen(): void;
/**
 * 【機能概要】: ポップアップの初期化処理
 * 【設計方針】:
 *   - DOM要素取得とイベントリスナー設定を分離して可読性向上
 *   - 各操作の責任が明確
 *   - デフォルトでメイン画面を表示
 * 🟢 要求定義（tdd-requirements.md 32-33行目、初期画面がメイン画面）
 */
export declare function init(): void;
//# sourceMappingURL=navigation.d.ts.map