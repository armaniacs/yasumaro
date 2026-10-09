/**
 * e2eTestState.ts
 * Single home + single publisher for the E2E test-probe state. Both write
 * routes — the window.__OW_TEST_STATE global and the data-ow-test-state
 * document attribute — are owned here so the emitted shape has one owner
 * and cannot drift between call sites.
 */

export interface OWTestState {
    maxScrollPercentage: number;
    isValidVisitReported: boolean;
    startTime: number;
    minVisitDuration: number;
    minScrollDepth: number;
    duration: number;
}

declare global {
    interface Window {
        __OW_TEST_STATE?: OWTestState;
    }
}

/**
 * Publish the E2E test state to both probe routes. Writes the window global
 * first, then the document attribute (each guarded independently for
 * non-DOM environments). JSON.stringify order follows OWTestState's declared
 * field order — keep it when adding fields to stay byte-stable for E2E.
 */
export function publishE2eTestState(state: OWTestState): void {
    if (typeof window !== 'undefined') {
        window.__OW_TEST_STATE = state;
    }
    if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-ow-test-state', JSON.stringify(state));
    }
}
