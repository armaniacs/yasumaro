/**
 * focusTrap.ts
 * フォーカストラップ実装 - モーダルのフォーカス管理
 */

interface TrapInfo {
  element: HTMLElement;
  handler: (e: KeyboardEvent) => void;
}

/** フォーカス可能要素のセレクタ（trap()と共有） */
const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * コンテナ内のフォーカス可能要素を全て返す（非表示要素は除外）。
 * trap() と popup/dashboard 側のタブ・パネル切り替えロジックで共有する
 * 単一の非表示判定基準。
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    return !el.closest('.hidden, [hidden]');
  });
}

/**
 * コンテナ内の最初のフォーカス可能要素を返す（非表示要素は除外）。
 * タブパネル切り替え時など、フォーカストラップ（Tab循環・Escキー処理）までは
 * 不要だが「最初の要素にフォーカスを移す」処理だけが必要な場面で使う。
 */
export function getFirstFocusableElement(container: HTMLElement): HTMLElement | null {
  return getFocusableElements(container)[0] ?? null;
}

/**
 * コンテナ内の最初のフォーカス可能要素にフォーカスを移す。
 * 要素が見つからない、またはDOMにアタッチされていない/非表示の場合は何もしない。
 */
export function focusFirstFocusableElement(container: HTMLElement): void {
  const target = getFirstFocusableElement(container);
  if (target && document.body.contains(target) && target.offsetParent !== null) {
    target.focus();
  }
}

/**
 * フォーカストラップの状態管理
 */
class FocusTrapManager {
  handlers: Map<string, TrapInfo>;
  previousFocus: Map<string, Element | null>;

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
  trap(modal: HTMLElement | string, closeCallback?: () => void): string {
    const modalElement = typeof modal === 'string'
      ? document.querySelector(modal) as HTMLElement
      : modal;

    if (!modalElement) {
      throw new Error('Modal element not found');
    }

    // 現在のフォーカスを保存
    const trapId = this.generateId();
    this.previousFocus.set(trapId, document.activeElement);

    // フォーカス可能な要素を取得（非表示要素は除外）
    const focusableElements = getFocusableElements(modalElement);
    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];

    if (!firstFocusable || !lastFocusable) {
      this.previousFocus.delete(trapId);
      return trapId;
    }

    // キーボードハンドラ
    const keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeCallback) {
        closeCallback();
        return;
      }
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        if (document.activeElement === firstFocusable) {
          e.preventDefault();
          lastFocusable.focus();
        }
      } else {
        if (document.activeElement === lastFocusable) {
          e.preventDefault();
          firstFocusable.focus();
        }
      }
    };

    modalElement.addEventListener('keydown', keydownHandler);
    this.handlers.set(trapId, { element: modalElement, handler: keydownHandler });

    // 最初のフォーカス可能要素にフォーカス
    if (firstFocusable && document.body.contains(firstFocusable) && firstFocusable.offsetParent !== null) {
      firstFocusable.focus();
    }

    return trapId;
  }

  /**
   * フォーカストラップを解放
   * @param {string} trapId - trap()で返されたID
   */
  release(trapId: string): void {
    const trapInfo = this.handlers.get(trapId);
    if (!trapInfo) return;

    const { element, handler } = trapInfo;
    element.removeEventListener('keydown', handler);
    this.handlers.delete(trapId);

    // 以前のフォーカスを復元
    const previousFocus = this.previousFocus.get(trapId);
    if (previousFocus && document.body.contains(previousFocus)) {
      (previousFocus as HTMLElement).focus();
    }
    this.previousFocus.delete(trapId);
  }

  /**
   * ユニークIDを生成
   * @returns {string}
   */
  generateId(): string {
    return `focusTrap_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * 全てのトラップを解放
   */
  releaseAll(): void {
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
export function trapFocus(modal: HTMLElement | string, closeCallback?: () => void): string {
  return focusTrapManager.trap(modal, closeCallback);
}

export function releaseFocusTrap(modal: HTMLElement): void {
  // モーダル要素からトラップIDを探して解放
  for (const [trapId, trapInfo] of focusTrapManager.handlers.entries()) {
    if (trapInfo.element === modal) {
      focusTrapManager.release(trapId);
      return;
    }
  }
}