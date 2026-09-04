/**
 * @vitest-environment jsdom
 */

/**
 * index.clone-dedup.test.ts (PBI 06: fix-clone-node-dedup)
 *
 * Locks the single-clone contract between the contentExtractor orchestrator
 * and cleanseAISummaryContent:
 * - full extractMainContent path (cleanseEnabled + aiSummary) clones exactly once
 * - alreadyCloned: true skips the internal clone and mutates the passed element
 * - omitted option keeps the legacy internal clone; the caller's element is untouched
 * - legacy vs alreadyCloned results are identical (counts, map, text, bytes)
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

    it('alreadyCloned: true performs zero clones and mutates the passed element', () => {
        const el = makeRoot();

        const spy = vi.spyOn(Element.prototype, 'cloneNode');
        const result = cleanseAISummaryContent(el, { ...CLEANSE_OPTS, alreadyCloned: true });

        expect(spy).not.toHaveBeenCalled();
        expect(result.totalRemoved).toBeGreaterThan(0);
        expect(el.querySelector('.advertisement')).toBeNull();
    });

    it('omitted option keeps the legacy internal clone and leaves the original untouched', () => {
        const el = makeRoot();
        const before = el.innerHTML;

        const spy = vi.spyOn(Element.prototype, 'cloneNode');
        const result = cleanseAISummaryContent(el, { ...CLEANSE_OPTS });

        expect(spy).toHaveBeenCalled();
        expect(el.innerHTML).toBe(before);
        expect(el.querySelector('.advertisement')).not.toBeNull();
        expect(result.totalRemoved).toBeGreaterThan(0);
    });

    it('legacy vs alreadyCloned agree on counts, removal map, text, and bytes', () => {
        const fullOpts = { ...CLEANSE_OPTS, measureBytes: true };

        const legacyRoot = makeRoot();
        const spy = vi.spyOn(Element.prototype, 'cloneNode');
        const legacyResult = cleanseAISummaryContent(legacyRoot, fullOpts);
        const internalClone = spy.mock.results[0]?.value as Element | undefined;
        expect(internalClone).toBeDefined();
        const legacyText = internalClone!.textContent;
        const legacyHtml = internalClone!.innerHTML;
        spy.mockRestore();

        const freshRoot = makeRoot();
        const ownedClone = freshRoot.cloneNode(true) as Element;
        const newResult = cleanseAISummaryContent(ownedClone, { ...fullOpts, alreadyCloned: true });

        expect(newResult.totalRemoved).toBe(legacyResult.totalRemoved);
        expect(newResult.removed).toEqual(legacyResult.removed);
        expect(ownedClone.textContent).toBe(legacyText);
        expect(ownedClone.innerHTML).toBe(legacyHtml);
        expect(newResult.bytesBefore).toBe(legacyResult.bytesBefore);
        expect(newResult.bytesAfter).toBe(legacyResult.bytesAfter);
    });
});
