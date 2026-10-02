/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { removeCollected, stripCollected } from '../selectorRules.js';
import { isLinkDenseBlock } from '../helpers.js';
import { stripLegalTextNodes, stripHighLinkDensityElements } from '../stripCore.js';
import {
    stripFixedElements,
    stripTextDensityElements,
    stripShortSequenceElements,
    stripSymbolLineElements,
    stripLinkOnlyParagraphs,
    stripAffiliateElements,
} from '../stripExtended.js';

const PROTECT_ATTR = 'data-ow-body-protected';

/** A div whose link share is exactly `ratio`, so the density gate is testable at its boundary. */
function densityHtml(totalChars: number, ratio: number): string {
    const linkChars = Math.round(totalChars * ratio);
    return `<div id="target"><a href="#">${'a'.repeat(linkChars)}</a>${'b'.repeat(totalChars - linkChars)}</div>`;
}

describe('strip scaffold', () => {
    let root: HTMLElement;
    beforeEach(() => {
        root = document.createElement('div');
        document.body.appendChild(root);
    });
    afterEach(() => {
        root.remove();
    });

    describe('removeCollected', () => {
        it('counts only the elements the action actually succeeded on', () => {
            root.innerHTML = `<p id="ok">a</p><p id="protected" ${PROTECT_ATTR}>b</p><p id="ok2">c</p>`;

            const removed = removeCollected(Array.from(root.querySelectorAll('p')));

            expect(removed).toBe(2);
            expect(root.querySelector('#ok')).toBeNull();
            expect(root.querySelector('#ok2')).toBeNull();
            expect(root.querySelector('#protected')).not.toBeNull();
        });

        it('returns 0 and mutates nothing when every application is refused', () => {
            root.innerHTML = '<p>a</p><p>b</p>';
            const before = root.innerHTML;

            const removed = removeCollected(Array.from(root.querySelectorAll('p')), () => false);

            expect(removed).toBe(0);
            expect(root.innerHTML).toBe(before);
        });
    });

    describe('stripCollected', () => {
        it('skips a group with an empty selector instead of querying it', () => {
            root.innerHTML = '<p>a</p><p>b</p>';

            const removed = stripCollected(root, [{ css: '' }, { css: 'p' }]);

            expect(removed).toBe(2);
        });

        it('claims an element matched by two groups only once', () => {
            root.innerHTML = '<div id="target">x</div>';

            const removed = stripCollected(root, [{ css: 'div' }, { css: 'div' }]);

            expect(removed).toBe(1);
        });

        it('collects the whole union before removing so an ancestor and a descendant both count', () => {
            root.innerHTML = '<div id="outer"><div id="inner">x</div></div>';

            const removed = stripCollected(root, [{ css: 'div#outer' }, { css: 'div#inner' }]);

            expect(removed).toBe(2);
            expect(root.querySelector('#outer')).toBeNull();
            expect(root.querySelector('#inner')).toBeNull();
        });

        it('passes the claimed set to the gate so it can reject nested matches', () => {
            root.innerHTML = '<div id="outer"><div id="inner">x</div></div>';
            const claimedSizes: number[] = [];

            const removed = stripCollected(root, [{
                css: 'div',
                predicate: (_el, claimed) => {
                    claimedSizes.push(claimed.size);
                    return claimed.size === 0;
                },
            }]);

            expect(claimedSizes).toEqual([0, 1]);
            expect(removed).toBe(1);
        });
    });

    describe('removal count is one definition across the non-selector strips', () => {
        const cases: Array<{ name: string; html: string; run: (r: Element) => number }> = [
            {
                name: 'stripLegalTextNodes',
                html: `<small id="protected" ${PROTECT_ATTR}>無断転載禁止</small><small id="target">無断転載禁止</small>`,
                run: (r) => stripLegalTextNodes(r),
            },
            {
                name: 'stripHighLinkDensityElements',
                html: `<div id="protected" ${PROTECT_ATTR}><a href="#">${'x'.repeat(120)}</a></div>` +
                    `<div id="target"><a href="#">${'x'.repeat(120)}</a></div>`,
                run: (r) => stripHighLinkDensityElements(r),
            },
            {
                name: 'stripFixedElements',
                html: `<div id="protected" ${PROTECT_ATTR} style="position: fixed"></div>` +
                    '<div id="target" style="position: fixed"></div>',
                run: (r) => stripFixedElements(r),
            },
            {
                name: 'stripTextDensityElements',
                html: `<div id="protected" ${PROTECT_ATTR}><a href="#">${'x'.repeat(60)}</a></div>` +
                    `<div id="target"><a href="#">${'x'.repeat(60)}</a></div>`,
                run: (r) => stripTextDensityElements(r),
            },
            {
                name: 'stripShortSequenceElements',
                html: '<ul><li>a</li><li>b</li><li>c</li><li>d</li>' +
                    `<li id="protected" ${PROTECT_ATTR}>e</li><li id="target">f</li></ul>`,
                run: (r) => stripShortSequenceElements(r),
            },
            {
                name: 'stripSymbolLineElements',
                html: `<p id="protected" ${PROTECT_ATTR}>►</p><p id="target">▶▶</p>`,
                run: (r) => stripSymbolLineElements(r),
            },
            {
                name: 'stripLinkOnlyParagraphs',
                html: `<p id="protected" ${PROTECT_ATTR}><a href="#">リンク</a></p>` +
                    '<p id="target"><a href="#">リンク</a></p>',
                run: (r) => stripLinkOnlyParagraphs(r),
            },
            {
                name: 'stripAffiliateElements',
                html: `<div class="yyi-rinker-contents" id="protected" ${PROTECT_ATTR}>` +
                    '<div class="yyi-rinker-title">商品名</div></div>' +
                    '<div class="yyi-rinker-contents" id="target">' +
                    '<div class="yyi-rinker-title">商品名</div></div>',
                run: (r) => stripAffiliateElements(r),
            },
        ];

        for (const c of cases) {
            it(`${c.name}: one removable and one protected candidate count as 1`, () => {
                root.innerHTML = c.html;

                const removed = c.run(root);

                expect(removed).toBe(1);
                expect(root.querySelector('#target')).toBeNull();
                expect(root.querySelector('#protected')).not.toBeNull();
            });
        }
    });

    describe('stripFixedElements query blocks share one claimed set', () => {
        it('counts an element matched by the fixed-style block and the game8 block once', () => {
            root.innerHTML = '<div id="target" class="game8-menu" style="position: fixed"></div>';

            const removed = stripFixedElements(root);

            expect(removed).toBe(1);
            expect(root.querySelector('#target')).toBeNull();
        });

        it('counts an ancestor and a descendant matched by different blocks', () => {
            root.innerHTML = '<div id="outer" style="position: fixed"><div id="inner" class="fixed-video"></div></div>';

            const removed = stripFixedElements(root);

            expect(removed).toBe(2);
            expect(root.querySelector('#outer')).toBeNull();
            expect(root.querySelector('#inner')).toBeNull();
        });

        it('keeps a game8 block that is not fixed or sticky', () => {
            root.innerHTML = '<div id="target" class="game8-menu">menu</div>';

            expect(stripFixedElements(root)).toBe(0);
            expect(root.querySelector('#target')).not.toBeNull();
        });
    });

    describe('isLinkDenseBlock', () => {
        it('rejects a block shorter than the minimum text length', () => {
            root.innerHTML = densityHtml(99, 1);

            expect(isLinkDenseBlock(root.querySelector('#target') as Element, 100, 0.7)).toBe(false);
        });

        it('accepts a block exactly at the minimum text length', () => {
            root.innerHTML = densityHtml(100, 1);

            expect(isLinkDenseBlock(root.querySelector('#target') as Element, 100, 0.7)).toBe(true);
        });

        it('accepts a link share exactly at the threshold and rejects one below it', () => {
            root.innerHTML = densityHtml(100, 0.7);
            const atThreshold = root.querySelector('#target') as Element;
            expect(isLinkDenseBlock(atThreshold, 50, 0.7)).toBe(true);
            expect(isLinkDenseBlock(atThreshold, 50, 0.71)).toBe(false);
        });

        it('rejects an empty block without dividing by zero', () => {
            root.innerHTML = '<div id="target"></div>';

            expect(isLinkDenseBlock(root.querySelector('#target') as Element, 0, 0.7)).toBe(false);
        });

        it('rejects a block with no links', () => {
            root.innerHTML = densityHtml(200, 0);

            expect(isLinkDenseBlock(root.querySelector('#target') as Element, 50, 0.7)).toBe(false);
        });
    });

    describe('both link-density strips reach the same verdict', () => {
        const cases = [
            { label: 'dense and over both minimums', totalChars: 120, ratio: 1 },
            { label: 'exactly at the threshold', totalChars: 120, ratio: 0.7 },
            { label: 'just below the threshold', totalChars: 120, ratio: 0.69 },
            { label: 'no links at all', totalChars: 120, ratio: 0 },
            { label: 'dense but under the 100-char floor', totalChars: 60, ratio: 1 },
            { label: 'under the 50-char floor', totalChars: 49, ratio: 1 },
        ];

        for (const c of cases) {
            it(`follows the single predicate: ${c.label}`, () => {
                const html = densityHtml(c.totalChars, c.ratio);
                const probe = document.createElement('div');
                probe.innerHTML = html;
                const el = probe.querySelector('#target') as Element;

                root.innerHTML = html;
                stripHighLinkDensityElements(root);
                const highLinkKept = root.querySelector('#target') !== null;

                root.innerHTML = html;
                stripTextDensityElements(root);
                const textDensityKept = root.querySelector('#target') !== null;

                // Each strip keeps the element exactly when the single predicate,
                // called with that strip's minimum length, says it is not dense.
                expect(highLinkKept).toBe(!isLinkDenseBlock(el, 100, 0.7));
                expect(textDensityKept).toBe(!isLinkDenseBlock(el, 50, 0.7));
            });
        }

        it('differs between the two paths only by the minimum text length', () => {
            const html = densityHtml(60, 1);

            root.innerHTML = html;
            stripHighLinkDensityElements(root);
            expect(root.querySelector('#target')).not.toBeNull();

            root.innerHTML = html;
            stripTextDensityElements(root);
            expect(root.querySelector('#target')).toBeNull();
        });
    });
});
