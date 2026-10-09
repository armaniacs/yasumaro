// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { publishE2eTestState, type OWTestState } from '../e2eTestState.js';

afterEach(() => {
    delete (window as unknown as { __OW_TEST_STATE?: unknown }).__OW_TEST_STATE;
    document.documentElement.removeAttribute('data-ow-test-state');
});

describe('publishE2eTestState', () => {
    it('writes the state to both the window global and the document attribute', () => {
        const state: OWTestState = {
            maxScrollPercentage: 42,
            isValidVisitReported: true,
            startTime: 1234,
            minVisitDuration: 7,
            minScrollDepth: 33,
            duration: 9.5,
        };

        publishE2eTestState(state);

        expect(window.__OW_TEST_STATE).toBe(state);
        const attr = document.documentElement.getAttribute('data-ow-test-state');
        expect(attr).toBe(
            '{"maxScrollPercentage":42,"isValidVisitReported":true,"startTime":1234,"minVisitDuration":7,"minScrollDepth":33,"duration":9.5}',
        );
        expect(JSON.parse(attr!)).toEqual(state);
    });
});
