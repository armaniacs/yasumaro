/**
 * @vitest-environment jsdom
 */

/**
 * index.clone-dedup.test.ts (PBI 06: fix-clone-node-dedup)
 *
 * Locks the single-clone contract between the contentExtractor orchestrator
 * and cleanseAISummaryContent:
 * - full extractMainContent path (cleanseEnabled + aiSummary) clones exactly once
 * - cleanseAISummaryContent MUTATES the passed element in place (no internal
 *   clone). The orchestrator hands us its scratch clone; standalone callers
 *   pass a disposable tree they own.
 * - results are deterministic and byte-identical across equivalent inputs
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanseAISummaryContent } from '../index.js';
import { extractMainContent } from '../../contentExtractor/index.js';

const BODY_TEXT = 'Article body paragraph with enough substance to survive cleansing and extraction. ';

const FIXTURE_HTML = `
    <h1>Dedup Test Article</h1>
    <p>${BODY_TEXT.repeat(8)}</p>
    <p>${BODY_TEXT.repeat(8)}</p>
    <img src="photo.jpg" alt="A descriptive alt text">
    <div class="advertisement">Promotional content removed by the ads rule.</div>
    <nav aria-label="site">Site navigation links here</nav>
`;

function makeRoot(): Element {
    const root = document.createElement('div');
    root.innerHTML = FIXTURE_HTML;
    return root;
}

const CLEANSE_OPTS = {
    adsEnabled: true,
    navEnabled: true,
    altEnabled: true,
    bodyProtectionEnabled: false,
} as const;

beforeEach(() => {
    document.body.innerHTML = '';
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('PBI 06 clone dedup', () => {
    it('full extractMainContent path (cleanseEnabled + aiSummary) calls cloneNode exactly once', () => {
        document.body.innerHTML = `<article>${FIXTURE_HTML}</article>`;

        const spy = vi.spyOn(Element.prototype, 'cloneNode');
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true },
            { aiSummaryCleanseEnabled: true, ...CLEANSE_OPTS },
        );

        expect(typeof result).toBe('string');
        expect((result as string)).toContain('Dedup Test Article');
        expect((result as string)).not.toContain('Promotional content');
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0]?.[0]).toBe(true);
    });

    it('cleanseAISummaryContent mutates the passed element in place with zero clones', () => {
        const el = makeRoot();

        const spy = vi.spyOn(Element.prototype, 'cloneNode');
        const result = cleanseAISummaryContent(el, { ...CLEANSE_OPTS });

        expect(spy).not.toHaveBeenCalled();
        expect(result.totalRemoved).toBeGreaterThan(0);
        expect(el.querySelector('.advertisement')).toBeNull();
    });

    it('cleansing is deterministic across equivalent inputs', () => {
        const fullOpts = { ...CLEANSE_OPTS, measureBytes: true };

        const rootA = makeRoot();
        const resultA = cleanseAISummaryContent(rootA, fullOpts);

        const rootB = makeRoot();
        const resultB = cleanseAISummaryContent(rootB, fullOpts);

        expect(resultB.totalRemoved).toBe(resultA.totalRemoved);
        expect(resultB.removed).toEqual(resultA.removed);
        expect(rootB.textContent).toBe(rootA.textContent);
        expect(rootB.innerHTML).toBe(rootA.innerHTML);
        expect(resultB.bytesBefore).toBe(resultA.bytesBefore);
        expect(resultB.bytesAfter).toBe(resultA.bytesAfter);
    });
});
