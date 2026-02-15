/**
 * sanitizePreview.ts
 * PII Sanitization Preview UI Logic
 * UF-401: マスク情報の可視化機能 - Refactorフェーズ実装
 *
 * 【実装方針】TDD Greenフェーズ対応 - モジュール読み込み時のDOMアクセスを回避
 * 🟡 黄信号: テスト環境でのDOMモック問題を解決するための実装変更
 * 🟢 青信号: Refactorフェーズ対応 - 定数化・JSDoc充実化・関数分割実装
 */
interface MaskedItem {
    type: string;
    [key: string]: any;
}
interface ConfirmationResult {
    confirmed: boolean;
    content: string | null;
}
/**
 * イベントリスナー初期化関数
 * 【機能概要】: プレビューモーダルのイベントリスナーを設定する
 *
 * 【PERF-007修正】ResizeObserverのメモリリーク防止:
 * - 既存のResizeObserverをdisconnectしてから再作成
 * - イベントリスナーの二重登録を防止
 */
export declare function initializeModalEvents(): void;
/**
 * モーダルイベントリスナーをクリーンアップ
 * 【機能概要】: 初期化されたイベントリスナーとResizeObserverを解放する
 * 【PERF-007対応】メモリリーク防止のためのクリーンアップ関数
 */
export declare function cleanupModalEvents(): void;
/**
 * プレビューモーダルを表示し、マスクされた個人情報を可視化する
 * UF-401: マスク情報の可視化機能 - Refactorフェーズ実装（定数化・JSDoc・関数分割）
 */
export declare function showPreview(content: string, maskedItems?: MaskedItem[] | null, maskedCount?: number): Promise<ConfirmationResult>;
/**
 * 次のマスク箇所へジャンプ
 */
export declare function jumpToNextMasked(): void;
/**
 * 前のマスク箇所へジャンプ
 */
export declare function jumpToPrevMasked(): void;
export {};
//# sourceMappingURL=sanitizePreview.d.ts.map