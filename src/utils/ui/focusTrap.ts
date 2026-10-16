/**
 * focusTrap.ts
 * フォーカストラップ実装 - モーダルのフォーカス管理
 */

interface TrapInfo {
  element: HTMLElement;
  handler: (e: KeyboardEvent) => void;
}

/**
 * Focusable-element selector shared by `trap()` and `confirmDialog`.
 *
 * Disabled controls are excluded because they cannot receive focus: leaving
 * them in the set made the Tab wrap-around condition (`activeElement === last`)
 * unsatisfiable, so Tab escaped an `aria-modal` dialog (PBI 2026-10-11-07).
 */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * コンテナ内のフォーカス可能要素を全て返す（非表示・disabled 要素は除外）。
 * trap() と popup/dashboard 側のタブ・パネル切り替えロジックで共有する
 * 単一の非表示判定基準。
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    if (el.closest('.hidden, [hidden]')) return false;
    // `[tabindex]` / `a[href]` can match a control carrying `disabled`; the
    // selector above covers the form controls, this covers anything else.
    return !el.hasAttribute('disabled');
  });
}

/**
 * Shared Tab-cycle + Escape handling for focus traps.
 *
 * The caller owns its focusable set: `getFocusables` is called per keydown and
 * returns the current list, so each component keeps its own selector and
 * disabled-element policy — `trap()` re-queries the modal through
 * `getFocusableElements()` (a control disabled after the trap was installed
 * drops out of the cycle, PBI 2026-10-11-07), confirmDialog re-queries its
 * dialog with `FOCUSABLE_SELECTOR`.
 *
 * Escape is routed to `onEscape` whenever provided, including when the set is
 * empty: an empty trap (no focusable element, all disabled) must still be
 * leaveable. Tab wraps focus from last to first (and first to last with Shift)
 * and stays a no-op on an empty set — nothing to wrap, so the early return
 * below is unchanged. Other keys are ignored.
 */
export function handleFocusCycle(
  event: KeyboardEvent,
  getFocusables: () => HTMLElement[],
  onEscape?: () => void,
): void {
  if (event.key === 'Escape') {
    onEscape?.();
    return;
  }
  if (event.key !== 'Tab') return;

  const focusables = getFocusables();
  if (focusables.length === 0) return;

  const first = focusables[0]!;
  const last = focusables[focusables.length - 1]!;

  if (event.shiftKey) {
    if (document.activeElement === first) {
      event.preventDefault();
      last.focus();
    }
  } else if (document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
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
 * Live-trap tripwire bound (PBI 2026-09-11-03). Normal usage holds at most a
 * handful (confirmation modal, private-page dialog, recording-failed dialog);
 * exceeding this means some path missed its release().
 */
const FOCUS_TRAP_MAX_LIVE = 10;

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

    // フォーカス可能な要素を取得（非表示要素は除外）。0件でも後段の
    // keydown ハンドラ登録は行う（下記コメント参照）。
    const focusableElements = getFocusableElements(modalElement);
    const firstFocusable = focusableElements[0];

    // PBI 2026-09-11-03 (round 6): tripwire — a missed release leaves both the
    // keydown handler and the map entry behind forever. Live traps above this
    // bound mean a release path was forgotten; warn instead of growing silently.
    if (this.handlers.size >= FOCUS_TRAP_MAX_LIVE) {
      // Tripwire: only reachable when a release path leaks.
      console.warn(`focusTrap: ${this.handlers.size} live traps exceed ${FOCUS_TRAP_MAX_LIVE} — a release() is missing`);
    }

    // キーボードハンドラ。フォーカス可能集合は keydown ごとに取り直す:
    // 開いた後に disabled 化された要素（保存中の submit 等）へ追随するため
    // （PBI 2026-10-11-07。固定取得だと末尾が disabled のとき折り返しが成立しない）。
    // フォーカス可能要素が0件（要素なし／全 disabled）でも必ず登録する:
    // 登録を省くと Escape が効かず、閉じる手段を持たないままモーダルに
    // 閉じ込められる（Tab 循環は handleFocusCycle 側で空集合を無害に無視する）。
    // previousFocus も残すため release() がフォーカスを元へ戻せる。
    const keydownHandler = (e: KeyboardEvent) => {
      handleFocusCycle(e, () => getFocusableElements(modalElement), closeCallback);
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