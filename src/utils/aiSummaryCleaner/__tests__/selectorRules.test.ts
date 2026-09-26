// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
    chunkSelector,
    SELECTOR_CHUNK_LENGTH,
    SELECTOR_RULE_DEFS,
    splitSelectorList,
    stripBySelectors,
    type SelectorRuleDef,
} from '../selectorRules.js';
import { buildClassIdSelectors } from '../helpers.js';

/** Pattern string whose `[class*="..."]` token is exactly `11 + pad.length` chars. */
const classToken = (pad: string): string => `[class*="${pad}"]`;

describe('selectorRules', () => {
    describe('splitSelectorList', () => {
        it('splits only at top-level commas and trims tokens', () => {
            expect(splitSelectorList('div , span , p')).toEqual(['div', 'span', 'p']);
        });

        it('keeps commas inside quotes, brackets and parens literal', () => {
            const selector = '[class*="a,b"], :is(x, y), [data-k="p,q"], span';
            expect(splitSelectorList(selector)).toEqual([
                '[class*="a,b"]',
                ':is(x, y)',
                '[data-k="p,q"]',
                'span',
            ]);
        });

        it('keeps an escaped comma literal', () => {
            expect(splitSelectorList('a\\,b, span')).toEqual(['a\\,b', 'span']);
        });

        it('drops empty tokens between duplicate commas', () => {
            expect(splitSelectorList('a,, b,')).toEqual(['a', 'b']);
        });
    });

    describe('chunkSelector', () => {
        it('returns a selector within the cap unchanged as a single chunk', () => {
            const selector = '[class*="ad"], [id*="ad"], div';
            expect(chunkSelector(selector)).toEqual([selector]);
        });

        it('keeps a selector of exactly SELECTOR_CHUNK_LENGTH characters as a single chunk', () => {
            const selector = classToken('a'.repeat(SELECTOR_CHUNK_LENGTH - 11));
            expect(selector.length).toBe(SELECTOR_CHUNK_LENGTH);
            expect(chunkSelector(selector)).toEqual([selector]);
        });

        it('splits a selector list of exactly 2048 characters into chunks within the cap', () => {
            const selector = `${classToken('a'.repeat(1012))}, ${classToken('b'.repeat(1012))}`;
            expect(selector.length).toBe(2048);

            const chunks = chunkSelector(selector);

            expect(chunks.length).toBeGreaterThan(1);
            for (const chunk of chunks) {
                expect(chunk.length).toBeLessThanOrEqual(SELECTOR_CHUNK_LENGTH);
            }
            expect(chunks.flatMap((c) => splitSelectorList(c))).toEqual(splitSelectorList(selector));
        });

        it('splits a selector list exceeding the limit into chunks within the cap', () => {
            const selector = `${classToken('a'.repeat(1012))}, ${classToken('b'.repeat(1012))}, ${classToken('c'.repeat(1012))}`;
            expect(selector.length).toBeGreaterThan(SELECTOR_CHUNK_LENGTH);

            const chunks = chunkSelector(selector);

            for (const chunk of chunks) {
                expect(chunk.length).toBeLessThanOrEqual(SELECTOR_CHUNK_LENGTH);
            }
            expect(chunks.flatMap((c) => splitSelectorList(c))).toEqual(splitSelectorList(selector));
        });

        it('keeps an oversized single selector as its own chunk without splitting it', () => {
            const oversized = classToken('a'.repeat(5000));
            const normal = 'div';
            const selector = `${oversized}, ${normal}`;

            const chunks = chunkSelector(selector);

            expect(chunks).toEqual([oversized, normal]);
        });

        it('chunks the real deep and jpLayout rule selectors within the cap', () => {
            for (const key of ['deep', 'jpLayout'] as const) {
                const def = SELECTOR_RULE_DEFS[key];
                const selector = buildClassIdSelectors(def.patterns ?? []);
                expect(selector.length).toBeGreaterThan(2048);

                const chunks = chunkSelector(selector);

                expect(chunks.length).toBeGreaterThan(1);
                for (const chunk of chunks) {
                    expect(chunk.length).toBeLessThanOrEqual(SELECTOR_CHUNK_LENGTH);
                }
            }
        });
    });

    describe('stripBySelectors', () => {
        /**
         * Two 700-char patterns build a 2844-char selector where each
         * pattern's `[class*],[id*]` pair (1421 chars) fills one chunk:
         * greedy packing flushes before the next pair exceeds the cap, so
         * class tokens of pattern A and B land in different chunks.
         */
        function twoChunkDef(predicate?: (el: Element) => boolean): SelectorRuleDef {
            const padA = 'a'.repeat(700);
            const padB = 'b'.repeat(700);
            const def: SelectorRuleDef = {
                key: 'test-two-chunk',
                patterns: [padA, padB],
            };
            if (predicate !== undefined) {
                def.predicate = predicate;
            }
            return def;
        }

        it('removes elements matched by a pattern selector longer than 2048 chars without a RangeError', () => {
            const selector = buildClassIdSelectors(SELECTOR_RULE_DEFS.jpLayout.patterns ?? []);
            expect(selector.length).toBeGreaterThan(2048);

            document.body.innerHTML = `
                <div>
                    <div class="l-footer">footer</div>
                    <div class="toc-container">toc</div>
                    <div class="access-counter">counter</div>
                    <p>Main content paragraph with enough text to be relevant.</p>
                </div>
            `;

            const removed = stripBySelectors(document.body, SELECTOR_RULE_DEFS.jpLayout);

            expect(removed).toBe(3);
            expect(document.querySelector('.l-footer')).toBeNull();
            expect(document.querySelector('.toc-container')).toBeNull();
            expect(document.querySelector('.access-counter')).toBeNull();
            expect(document.querySelector('p')).not.toBeNull();
        });

        it('removes deep-rule elements whose built selector exceeds 2048 chars', () => {
            const selector = buildClassIdSelectors(SELECTOR_RULE_DEFS.deep.patterns ?? []);
            expect(selector.length).toBeGreaterThan(2048);

            document.body.innerHTML = `
                <article>
                    <p>Main content paragraph with enough text to be relevant.</p>
                    <div class="related-articles">related items</div>
                </article>
            `;

            const removed = stripBySelectors(document.body, SELECTOR_RULE_DEFS.deep);

            expect(removed).toBeGreaterThanOrEqual(1);
            expect(document.querySelector('.related-articles')).toBeNull();
        });

        it('counts an element matched in multiple chunks only once', () => {
            const predicate = vi.fn(() => true);
            document.body.innerHTML = `<div class="${'a'.repeat(700)} ${'b'.repeat(700)}">x</div>`;

            const removed = stripBySelectors(document.body, twoChunkDef(predicate));

            expect(removed).toBe(1);
            expect(predicate).toHaveBeenCalledTimes(1);
            expect(document.body.querySelector('div')).toBeNull();
        });

        it('removes an ancestor and descendant matched in different chunks exactly once each', () => {
            const predicate = vi.fn(() => true);
            document.body.innerHTML = `
                <div class="${'a'.repeat(700)}">
                    <div class="${'b'.repeat(700)}">leaf</div>
                </div>
            `;

            const removed = stripBySelectors(document.body, twoChunkDef(predicate));

            expect(removed).toBe(2);
            expect(predicate).toHaveBeenCalledTimes(2);
            expect(document.body.querySelector('div')).toBeNull();
        });
    });
});
