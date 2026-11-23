/**
 * content-extractor.test.ts (PBI 2026-11-08-05)
 * The unlisted-script entry wires listeners then awaits init — an init
 * rejection must surface (console.warn) instead of leaving an armed but
 * dead extractor.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForMock, drainMacrotask } from '../../testDir/waitPolicy.js';

const mocks = vi.hoisted(() => ({
    registerGetContentListener: vi.fn(),
    registerGetSelectionListener: vi.fn(),
    init: vi.fn(),
}));

vi.mock('wxt/utils/define-unlisted-script', () => ({
    defineUnlistedScript: (opts: unknown) => opts,
}));

vi.mock('../../src/content/extractor.js', () => ({
    registerGetContentListener: mocks.registerGetContentListener,
    registerGetSelectionListener: mocks.registerGetSelectionListener,
    init: mocks.init,
}));

import contentExtractorEntry from '../content-extractor.js';

const entry = contentExtractorEntry as unknown as { main: () => void };

beforeEach(() => {
    vi.clearAllMocks();
    mocks.init.mockResolvedValue(undefined);
    vi.stubGlobal('chrome', { runtime: { onMessage: {} } });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('content-extractor entry', () => {
    describe('init wiring', () => {
        it('registers both listeners and starts init', async () => {
            entry.main();

            await waitForMock(() => expect(mocks.init).toHaveBeenCalled());
            expect(mocks.registerGetContentListener).toHaveBeenCalledTimes(1);
            expect(mocks.registerGetSelectionListener).toHaveBeenCalledTimes(1);
            expect(vi.mocked(console.warn)).not.toHaveBeenCalled();
        });

        it('warns visibly when init rejects instead of dying silently', async () => {
            mocks.init.mockRejectedValueOnce(new Error('settings boom'));

            entry.main();

            await waitForMock(() =>
                expect(vi.mocked(console.warn)).toHaveBeenCalledWith(
                    '[OWeave] content-extractor init failed',
                    expect.any(Error),
                ),
            );
            // The listeners stay armed — only the failure becomes visible.
            expect(mocks.registerGetContentListener).toHaveBeenCalledTimes(1);
            expect(mocks.registerGetSelectionListener).toHaveBeenCalledTimes(1);
        });

        it('stays quiet when init succeeds', async () => {
            entry.main();

            await waitForMock(() => expect(mocks.init).toHaveBeenCalled());
            await drainMacrotask();
            expect(vi.mocked(console.warn)).not.toHaveBeenCalled();
        });
    });
});
