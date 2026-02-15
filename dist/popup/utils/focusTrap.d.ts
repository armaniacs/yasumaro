/**
 * focusTrap.ts
 * フォーカストラップ実装 - モーダルのフォーカス管理
 */
interface TrapInfo {
    element: HTMLElement;
    handler: (e: KeyboardEvent) => void;
}
/**
 * フォーカストラップの状態管理
 */
declare class FocusTrapManager {
    handlers: Map<string, TrapInfo>;
    previousFocus: Map<string, Element | null>;
    constructor();
    /**
     * モーダルにフォーカストラップを設定
     * @param {HTMLElement|String} modal - モーダル要素またはセレクタ
     * @param {Function} closeCallback - ESCキー押下時に呼び出すコールバック
     * @returns {string} - トラップID（解放時に使用）
     */
    trap(modal: HTMLElement | string, closeCallback?: () => void): string;
    /**
     * フォーカストラップを解放
     * @param {string} trapId - trap()で返されたID
     */
    release(trapId: string): void;
    /**
     * ユニークIDを生成
     * @returns {string}
     */
    generateId(): string;
    /**
     * 全てのトラップを解放
     */
    releaseAll(): void;
}
export declare const focusTrapManager: FocusTrapManager;
export { FocusTrapManager };
export declare function trapFocus(modal: HTMLElement | string, closeCallback?: () => void): string;
export declare function releaseFocusTrap(modal: HTMLElement): void;
//# sourceMappingURL=focusTrap.d.ts.map