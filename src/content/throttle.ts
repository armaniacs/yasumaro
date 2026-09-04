/**
 * throttle.ts
 * Throttle via requestAnimationFrame — shared with extractor for backward compat.
 * Moved verbatim from ContentKernel (PBI 15 pure-extraction refactor).
 */

export function throttle<T extends (...args: unknown[]) => void>(fn: T): T {
    let lastCall = 0;
    let rafId: number | null = null;
    let lastArgs: Parameters<T> | null = null;
    const throttledFn = ((...args: Parameters<T>) => {
        lastArgs = args;
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        const THROTTLE_DELAY = 100;
        rafId = requestAnimationFrame(() => {
            rafId = null;
            const callNow = performance.now() - lastCall >= THROTTLE_DELAY;
            if (callNow && lastArgs) {
                lastCall = performance.now();
                fn(...lastArgs);
            } else if (lastArgs) {
                if (performance.now() - lastCall >= THROTTLE_DELAY) {
                    lastCall = performance.now();
                    fn(...lastArgs);
                }
            }
        });
    }) as T;
    if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', () => {
            if (rafId !== null) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }
        });
    }
    return throttledFn;
}
