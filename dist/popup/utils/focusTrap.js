/**
 * focusTrap.ts
 * フォーカストラップ実装 - モーダルのフォーカス管理
 */
/**
 * フォーカストラップの状態管理
 */
class FocusTrapManager {
    handlers;
    previousFocus;
    constructor() {
        this.handlers = new Map();
        this.previousFocus = new Map();
    }
    /**
     * モーダルにフォーカストラップを設定
     * @param {HTMLElement|String} modal - モーダル要素またはセレクタ
     * @param {Function} closeCallback - ESCキー押下時に呼び出すコールバック
     * @returns {string} - トラップID（解放時に使用）
     */
    trap(modal, closeCallback) {
        const modalElement = typeof modal === 'string'
            ? document.querySelector(modal)
            : modal;
        if (!modalElement) {
            throw new Error('Modal element not found');
        }
        // 現在のフォーカスを保存
        const trapId = this.generateId();
        this.previousFocus.set(trapId, document.activeElement);
        // フォーカス可能な要素を取得
        const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
        const focusableElements = modalElement.querySelectorAll(focusableSelector);
        const firstFocusable = focusableElements[0];
        const lastFocusable = focusableElements[focusableElements.length - 1];
        if (!firstFocusable || !lastFocusable) {
            this.previousFocus.delete(trapId);
            return trapId;
        }
        // キーボードハンドラ
        const keydownHandler = (e) => {
            if (e.key === 'Escape' && closeCallback) {
                closeCallback();
                return;
            }
            if (e.key !== 'Tab')
                return;
            if (e.shiftKey) {
                if (document.activeElement === firstFocusable) {
                    e.preventDefault();
                    lastFocusable.focus();
                }
            }
            else {
                if (document.activeElement === lastFocusable) {
                    e.preventDefault();
                    firstFocusable.focus();
                }
            }
        };
        modalElement.addEventListener('keydown', keydownHandler);
        this.handlers.set(trapId, { element: modalElement, handler: keydownHandler });
        // 最初のフォーカス可能要素にフォーカス
        if (firstFocusable && document.body.contains(firstFocusable)) {
            firstFocusable.focus();
        }
        return trapId;
    }
    /**
     * フォーカストラップを解放
     * @param {string} trapId - trap()で返されたID
     */
    release(trapId) {
        const trapInfo = this.handlers.get(trapId);
        if (!trapInfo)
            return;
        const { element, handler } = trapInfo;
        element.removeEventListener('keydown', handler);
        this.handlers.delete(trapId);
        // 以前のフォーカスを復元
        const previousFocus = this.previousFocus.get(trapId);
        if (previousFocus && document.body.contains(previousFocus)) {
            previousFocus.focus();
        }
        this.previousFocus.delete(trapId);
    }
    /**
     * ユニークIDを生成
     * @returns {string}
     */
    generateId() {
        return `focusTrap_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    /**
     * 全てのトラップを解放
     */
    releaseAll() {
        for (const trapId of this.handlers.keys()) {
            this.release(trapId);
        }
    }
}
// シングルトンインスタンス
export const focusTrapManager = new FocusTrapManager();
// 互換性のためのクラスもエクスポート
export { FocusTrapManager };
// 簡易関数もエクスポート（既存コードとの互換性）
export function trapFocus(modal, closeCallback) {
    return focusTrapManager.trap(modal, closeCallback);
}
export function releaseFocusTrap(modal) {
    // モーダル要素からトラップIDを探して解放
    for (const [trapId, trapInfo] of focusTrapManager.handlers.entries()) {
        if (trapInfo.element === modal) {
            focusTrapManager.release(trapId);
            return;
        }
    }
}
//# sourceMappingURL=focusTrap.js.map