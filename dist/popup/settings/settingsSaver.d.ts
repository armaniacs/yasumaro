/**
 * 設定保存と接続テストモジュール
 * 設定の保存と保存後の接続テストを行う
 */
/**
 * 設定保存ボタンクリックハンドラ
 * @param {HTMLElement} statusDiv - ステータス表示要素
 * @param {HTMLInputElement} protocolInput - プロトコル入力
 * @param {HTMLInputElement} portInput - ポート入力
 * @param {HTMLInputElement} minVisitDurationInput - 最小訪問時間入力
 * @param {HTMLInputElement} minScrollDepthInput - 最小スクロール深度入力
 * @param {Record<string, HTMLInputElement | HTMLSelectElement>} settingsMapping - 設定マッピング
 * @param {Function} validateFn - バリデーション関数
 * @returns {Promise<void>}
 */
export declare function handleSaveAndTest(statusDiv: HTMLElement, protocolInput: HTMLInputElement, portInput: HTMLInputElement, minVisitDurationInput: HTMLInputElement, minScrollDepthInput: HTMLInputElement, settingsMapping: Record<string, HTMLInputElement | HTMLSelectElement>, validateFn: (p1: HTMLInputElement, p2: HTMLInputElement, p3: HTMLInputElement, p4: HTMLInputElement) => boolean): Promise<void>;
/**
 * 保存ボタンにクリックイベントリスナーを設定
 * @param {HTMLButtonElement} saveBtn - 保存ボタン
 * @param {HTMLElement} statusDiv - ステータス表示要素
 * @param {HTMLInputElement} protocolInput - プロトコル入力
 * @param {HTMLInputElement} portInput - ポート入力
 * @param {HTMLInputElement} minVisitDurationInput - 最小訪問時間入力
 * @param {HTMLInputElement} minScrollDepthInput - 最小スクロール深度入力
 * @param {Record<string, HTMLInputElement | HTMLSelectElement>} settingsMapping - 設定マッピング
 * @returns {() => void} リスナー削除関数
 */
export declare function setupSaveButtonListener(saveBtn: HTMLButtonElement, statusDiv: HTMLElement, protocolInput: HTMLInputElement, portInput: HTMLInputElement, minVisitDurationInput: HTMLInputElement, minScrollDepthInput: HTMLInputElement, settingsMapping: Record<string, HTMLInputElement | HTMLSelectElement>): () => void;
//# sourceMappingURL=settingsSaver.d.ts.map