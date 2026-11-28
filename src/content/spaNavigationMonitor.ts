/**
 * SpaNavigationMonitor — SPA navigation detection extracted from
 * contentKernel.ts (PBI 2026-11-28-02, holistic review themes 2 + 5).
 *
 * Owns the three detection mechanisms the kernel previously inlined:
 * isolated-world history wrapping (pushState/replaceState/popstate),
 * MAIN-world location polling (content scripts cannot use
 * chrome.webNavigation), and the guarded reset decision (fragment-stripped
 * comparison). The kernel wires the reset side only.
 */

const defaultSpaPollTimer: SpaPollTimer = {
    setInterval: (callback, ms) => setInterval(callback, ms),
    clearInterval: (id) => clearInterval(id),
};

export { defaultSpaPollTimer };

/**
 * Review No.2: fragment-stripped comparison for SPA navigation. A hash-only
 * change (same document, e.g. an in-page anchor hop) keeps the stripped
 * form identical, so it never resets the visit — only a true path/query
 * change does.
 */
export function stripUrlFragment(url: string): string {
    const hashIndex = url.indexOf('#');
    return hashIndex === -1 ? url : url.slice(0, hashIndex);
}

/**
 * Review No.2: guarded navigation decision. Same-URL (shallow) and
 * hash-only (same-document anchor) updates are recorded without reset;
 * only a true fragment-stripped URL change resets.
 */
export function shouldResetForUrlChange(current: string, lastUrl: string | null): boolean {
    if (lastUrl === null) return false;
    if (stripUrlFragment(current) === stripUrlFragment(lastUrl)) return false;
    return true;
}

export interface SpaPollTimer {
    setInterval: (callback: () => void, ms: number) => ReturnType<typeof setInterval>;
    clearInterval: (id: ReturnType<typeof setInterval>) => void;
}

export interface SpaNavigationMonitorDeps {
    /** Reads the current location (injectable for non-browser tests). */
    readUrl: () => string | null;
    /** Called exactly once per true fragment-stripped URL change. */
    onNavigation: () => void;
    /** Timer seam so tests never wait in real time. */
    timer?: SpaPollTimer;
}

export class SpaNavigationMonitor {
    private readonly deps: SpaNavigationMonitorDeps;
    private readonly timer: SpaPollTimer;
    /** PBI 2026-11-08-02: history wrapping must happen at most once per monitor. */
    private spaSubscribed = false;
    /** Review No.1/No.2: last URL observed by the SPA seam. */
    private lastSpaUrl: string | null = null;
    /** Review No.1: active MAIN-world poll stopper (null when not polling). */
    private spaPollStop: (() => void) | null = null;
    /** Review No.1: last poll arm config, for symmetric re-arm after a stop. */
    private spaPollConfig: { intervalMs: number; timer: SpaPollTimer } | null = null;

    constructor(deps: SpaNavigationMonitorDeps) {
        this.deps = deps;
        this.timer = deps.timer ?? defaultSpaPollTimer;
    }

    getLastUrl(): string | null {
        return this.lastSpaUrl;
    }

    /**
     * Isolated-world backing: wrap pushState/replaceState and listen for
     * popstate. Idempotent — a second subscribe is a no-op returning the
     * active unsubscribe (or a noop when history is unavailable).
     */
    subscribeHistory(): () => void {
        const noop = (): void => {};
        if (typeof window === 'undefined' || typeof history === 'undefined') return noop;
        if (this.spaSubscribed) return noop;
        this.spaSubscribed = true;
        this.lastSpaUrl = this.readUrl();
        const target = window.history;
        const originalPush = target.pushState.bind(target);
        const originalReplace = target.replaceState.bind(target);
        const onNavigate = (): void => {
            this.pollOnce();
        };
        const wrappedPush = (...args: Parameters<History['pushState']>): void => {
            originalPush(...args);
            onNavigate();
        };
        const wrappedReplace = (...args: Parameters<History['replaceState']>): void => {
            originalReplace(...args);
            onNavigate();
        };
        target.pushState = wrappedPush;
        target.replaceState = wrappedReplace;
        window.addEventListener('popstate', onNavigate);
        return () => {
            target.pushState = originalPush as History['pushState'];
            target.replaceState = originalReplace as History['replaceState'];
            window.removeEventListener('popstate', onNavigate);
            this.spaSubscribed = false;
        };
    }

    /**
     * MAIN-world backing (content scripts cannot use chrome.webNavigation).
     * Idempotent — returns the active stopper so a repeated arm never stacks
     * a second interval behind the first, and remembers the arm config so a
     * symmetric re-arm does not need the caller to re-supply interval/timer.
     */
    startPolling(intervalMs = 2000, timer: SpaPollTimer = this.timer): () => void {
        if (this.spaPollStop !== null) return this.spaPollStop;
        this.spaPollConfig = { intervalMs, timer };
        if (this.lastSpaUrl === null) this.lastSpaUrl = this.readUrl();
        const id = timer.setInterval(() => {
            this.pollOnce();
        }, intervalMs);
        this.spaPollStop = () => {
            timer.clearInterval(id);
            this.spaPollStop = null;
        };
        return this.spaPollStop;
    }

    stopPolling(): void {
        if (this.spaPollStop !== null) {
            const stop = this.spaPollStop;
            this.spaPollStop = null;
            stop();
        }
    }

    /**
     * Review No.1: symmetric re-arm of the MAIN-world poll — re-arms only
     * when a poll was configured via startPolling() and none is running.
     */
    rearmPolling(): void {
        if (this.spaPollConfig !== null && this.spaPollStop === null) {
            this.startPolling(this.spaPollConfig.intervalMs, this.spaPollConfig.timer);
        }
    }

    /**
     * Review No.1/No.2: single-shot URL check behind both the isolated
     * wrappers and the MAIN-world poll. Returns true only on a true URL
     * change (the caller then performs its reset); records the URL and
     * returns false on first observation or when unchanged.
     */
    pollOnce(): boolean {
        const current = this.readUrl();
        if (current === null) return false;
        if (this.lastSpaUrl === null) {
            this.lastSpaUrl = current;
            return false;
        }
        const changed = shouldResetForUrlChange(current, this.lastSpaUrl);
        this.lastSpaUrl = current;
        if (changed) this.deps.onNavigation();
        return changed;
    }

    private readUrl(): string | null {
        return this.deps.readUrl();
    }
}
