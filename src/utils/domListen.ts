/**
 * domListen.ts
 * Null-tolerant addEventListener that records its own undo, so a panel's
 * destroy() can remove every listener it attached.
 */

export type Listen = (
  target: EventTarget | null | undefined,
  type: string,
  handler: EventListenerOrEventListenerObject,
) => void;

/**
 * Bind `listen` to a teardown list owned by the caller. Each registration
 * pushes its remover onto `teardown`; draining that list is the caller's
 * destroy() step. A missing target is skipped because panels wire optional
 * elements that a given page may not render.
 */
export function createListen(teardown: Array<() => void>): Listen {
  return (target, type, handler) => {
    if (!target) return;
    target.addEventListener(type, handler);
    teardown.push(() => target.removeEventListener(type, handler));
  };
}
