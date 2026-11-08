// @vitest-environment jsdom
/**
 * settingsUiHelper.mirror-failure.test.ts — PBI 2026-11-08-09 (4)
 *
 * Pins that a #status -> #statusTop mirror failure is visible instead of
 * silent: a warning is logged, the source element carries a failure flag,
 * and the source message itself stays intact.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { showStatus, clearStatus } from '../settingsUiHelper.js';

function breakStatusTopLookup(): void {
    const original = document.getElementById.bind(document);
    vi.spyOn(document, 'getElementById').mockImplementation((id: string) => {
        if (id === 'statusTop') {
            throw new Error('detached #statusTop');
        }
        return original(id);
    });
}

describe('settingsUiHelper mirror failure', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('mirrorStatusToTop', () => {
        it('warns and flags the source element when the top mirror fails', () => {
            document.body.innerHTML = `<div id="status"></div><div id="statusTop"></div>`;
            breakStatusTopLookup();
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

            showStatus('status', 'hello', 'success', { autoClear: false });

            const el = document.getElementById('status');
            expect(el?.textContent).toBe('hello');
            expect(warn).toHaveBeenCalledTimes(1);
            expect(el?.dataset.statusMirrorFailed).toBe('1');
        });

        it('leaves no failure flag when the mirror succeeds', () => {
            document.body.innerHTML = `<div id="status"></div><div id="statusTop"></div>`;
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

            showStatus('status', 'hello', 'success', { autoClear: false });

            expect(document.getElementById('statusTop')?.textContent).toBe('hello');
            expect(warn).not.toHaveBeenCalled();
            expect(document.getElementById('status')?.dataset.statusMirrorFailed).toBeUndefined();
        });

        it('keeps the cleared source message intact when the mirror fails on clear', () => {
            document.body.innerHTML = `<div id="status"></div><div id="statusTop"></div>`;
            showStatus('status', 'hello', 'success', { autoClear: false });
            breakStatusTopLookup();
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

            clearStatus('status');

            const el = document.getElementById('status');
            expect(el?.textContent).toBe('');
            expect(el?.className).toBe('status-message');
            expect(warn).toHaveBeenCalledTimes(1);
            expect(el?.dataset.statusMirrorFailed).toBe('1');
        });
    });
});
