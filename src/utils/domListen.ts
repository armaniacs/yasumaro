/**
 * domListen.ts — null-safe DOM event binding shared helper.
 *
 * Seven dashboard/settings files duplicated a 5-line `listen` (null guard →
 * addEventListener → teardown push) with real drift (trustSettings uses a
 * generic `<T>`, webhookExportSettings narrows to `EventListener`). A single
 * implementation removes the fix-omission risk.
 *
 * `makeListener` binds the caller-owned teardown array so existing 3-arg call
 * sites keep working unchanged; `listen` is the same core with an explicit
 * teardown parameter for new code.
 */

export type Listen = (
    target: EventTarget | null | undefined,
    type: string,
    handler: EventListenerOrEventListenerObject,
) => void;

export function listen(
    target: EventTarget | null | undefined,
    type: string,
    handler: EventListenerOrEventListenerObject,
    teardown: Array<() => void>,
): void {
    if (!target) return;
    target.addEventListener(type, handler);
    teardown.push(() => target.removeEventListener(type, handler));
}

export function makeListener(teardown: Array<() => void>): Listen {
    return (target, type, handler) => listen(target, type, handler, teardown);
}
