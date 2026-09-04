/**
 * watchDynamicContent.ts
 * 30-13: SPA dynamic content observation — standalone MutationObserver helper.
 * Moved verbatim from contentKernel.ts (PBI 15 pure-extraction refactor).
 * The debounce default of 500ms is SPA behavior — do not change.
 */

/**
 * 30-13: SPA 動的コンテンツ監視 — スタンドアロン関数。
 * MutationObserver で target の childList 変化を監視し、debounce 500ms で onChange を呼ぶ。
 * @param target 監視対象（nullなら document.body）
 * @param onChange 変化時に呼ぶコールバック（debounce 500ms）
 * @param debounceMs デバウンス時間（デフォルト500ms）
 * @returns 監視を停止する disconnect 関数
 */
export function watchDynamicContent(
    target: Element | Document | null,
    onChange: () => void,
    debounceMs = 500,
): () => void {
    const observedTarget: Element | Document | null =
        target ??
        (typeof document !== 'undefined' ? (document.body as Element | null) ?? document.documentElement ?? null : null);

    if (!observedTarget) {
        return () => {};
    }

    const ObserverCtor =
        (typeof globalThis !== 'undefined' && (globalThis as unknown as { MutationObserver?: typeof MutationObserver }).MutationObserver) ??
        (typeof window !== 'undefined' && (window as unknown as { MutationObserver?: typeof MutationObserver }).MutationObserver) ??
        null;

    if (!ObserverCtor) {
        return () => {};
    }

    let timer: ReturnType<typeof setTimeout> | null = null;

    const observer = new ObserverCtor(() => {
        if (timer !== null) {
            clearTimeout(timer as unknown as number);
        }
        timer = setTimeout(() => {
            timer = null;
            onChange();
        }, debounceMs) as unknown as ReturnType<typeof setTimeout>;
    });

    try {
        observer.observe(observedTarget as unknown as Node, { childList: true, subtree: true });
    } catch {
        // target が observe 不可なら何もしない
        return () => {};
    }

    return () => {
        if (timer !== null) {
            clearTimeout(timer as unknown as number);
            timer = null;
        }
        observer.disconnect();
    };
}
