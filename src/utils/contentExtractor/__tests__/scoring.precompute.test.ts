/**
 * @vitest-environment jsdom
 */

import { calculateTextScore, findMainContentCandidates, scoreAndSort } from '../scoring.js';

describe('scoring precompute', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    describe('scoreAndSort calls scoreFn exactly N times', () => {
        it('calls scoreFn N times for N candidates (not O(N log N))', () => {
            document.body.innerHTML = Array.from({ length: 20 }, (_, i) => `<div class="c${i}"><p>content ${i} ${'x'.repeat(i * 5)}</p></div>`).join('');
            const elements = Array.from(document.querySelectorAll('div')) as Element[];
            expect(elements.length).toBe(20);

            const spy = vi.fn((el: Element) => calculateTextScore(el));
            const result = scoreAndSort(elements, 3, spy);

            expect(spy).toHaveBeenCalledTimes(20);
            // result should be top 3 sorted desc by score
            expect(result.length).toBe(3);
            // verify descending order by recalculating scores
            const scores = result.map((el) => calculateTextScore(el));
            for (let i = 0; i < scores.length - 1; i++) {
                expect(scores[i]).toBeGreaterThanOrEqual(scores[i + 1]!);
            }
        });

        it('calls scoreFn exactly once per element with small N', () => {
            document.body.innerHTML = `
                <div class="a"><p>short</p></div>
                <div class="b"><p>${'long '.repeat(30)}</p></div>
                <div class="c"><p>medium ${'y'.repeat(50)}</p></div>
            `;
            const elements = Array.from(document.querySelectorAll('div')) as Element[];
            const spy = vi.fn((el: Element) => calculateTextScore(el));
            scoreAndSort(elements, 2, spy);
            expect(spy).toHaveBeenCalledTimes(3);
        });

        it('default scoreFn is calculateTextScore (no injection)', () => {
            document.body.innerHTML = `
                <div class="a">plain text</div>
                <div class="b"><p>${'hello '.repeat(20)}</p><h2>title</h2></div>
            `;
            const elements = Array.from(document.querySelectorAll('div')) as Element[];
            const sorted = scoreAndSort(elements, 2);
            // b should rank higher than a due to p/h scoring
            expect(sorted[0]!.className).toBe('b');
            expect(sorted[1]!.className).toBe('a');
        });
    });

    describe('calculateTextScore does not use innerText', () => {
        it('element whose innerText getter throws still scores via textContent', () => {
            document.body.innerHTML = '<div class="throw-test"><p>hello world</p></div>';
            const el = document.querySelector('.throw-test') as HTMLElement;
            Object.defineProperty(el, 'innerText', {
                get() {
                    throw new Error('innerText should not be accessed');
                },
                configurable: true,
            });
            // should not throw
            expect(() => calculateTextScore(el)).not.toThrow();
            const score = calculateTextScore(el);
            // textContent length >0 so score >0
            expect(score).toBeGreaterThan(0);
            // score should equal text length + p*50
            const expectedTextLen = (el.textContent || '').length;
            // contains one <p> => +50
            expect(score).toBe(expectedTextLen + 50);
        });

        it('link innerText getter throwing still uses textContent for link length', () => {
            document.body.innerHTML = `
                <div class="parent">
                    Some text content here for parent length.
                    <a class="link-a" href="#">link text here</a>
                </div>
            `;
            const parent = document.querySelector('.parent') as Element;
            const link = document.querySelector('.link-a') as HTMLElement;
            Object.defineProperty(link, 'innerText', {
                get() {
                    throw new Error('innerText should not be accessed on <a>');
                },
                configurable: true,
            });
            expect(() => calculateTextScore(parent)).not.toThrow();
            const score = calculateTextScore(parent);
            expect(score).toBeGreaterThan(0);
        });

        it('calculates score correctly using textContent only', () => {
            document.body.innerHTML = `
                <div class="scored">
                    <h2>Heading</h2>
                    <p>Paragraph</p>
                    <ul><li>item</li></ul>
                </div>
            `;
            const el = document.querySelector('.scored')!;
            // manually compute expected: text.length + p*50 + h*100 + list*30
            const textLen = (el.textContent || '').length;
            // has 1 p, 1 h2, 1 ul
            const expected = textLen + 50 + 100 + 30;
            // linkRatio low so no 0.3
            expect(calculateTextScore(el)).toBe(expected);
        });
    });

    describe('candidate order/count regression (explicit expected order)', () => {
        it('article/main path returns top 1 sorted desc (long before short)', () => {
            document.body.innerHTML = `
                <article class="short">Short.</article>
                <article class="long">
                    <h1>Long Article</h1>
                    <p>Paragraph one with substantial content for scoring.</p>
                    <p>Paragraph two with more substantial content.</p>
                    <p>Paragraph three with even more content.</p>
                </article>
            `;
            const candidates = findMainContentCandidates();
            // article path: only top 1
            expect(candidates.length).toBe(1);
            expect(candidates[0]!.className).toBe('long');
            // explicit numeric order check
            const shortEl = document.querySelector('.short')!;
            const longEl = document.querySelector('.long')!;
            expect(calculateTextScore(longEl)).toBeGreaterThan(calculateTextScore(shortEl));
        });

        it('asian path returns up to 3 sorted desc', () => {
            document.body.innerHTML = `
                <div class="main-content"><p>${'A '.repeat(80)}</p><h2>title</h2></div>
                <div class="content-article"><p>${'B '.repeat(40)}</p></div>
                <div class="post-content"><p>${'C '.repeat(10)}</p></div>
                <section class="article-body"><p>${'D '.repeat(5)}</p></section>
            `;
            const candidates = findMainContentCandidates();
            // asian detection picks div, section with asian classnames
            expect(candidates.length).toBeGreaterThan(0);
            expect(candidates.length).toBeLessThanOrEqual(3);
            // candidates should be sorted desc by score
            const scores = candidates.map((el) => calculateTextScore(el));
            for (let i = 0; i < scores.length - 1; i++) {
                expect(scores[i]).toBeGreaterThanOrEqual(scores[i + 1]!);
            }
            // explicit expected order: main-content has highest score (longest + h2)
            expect(candidates[0]!.className).toBe('main-content');
        });

        it('hierarchical fallback returns up to 3 sorted desc (body children)', () => {
            document.body.innerHTML = `
                <div class="section-a"><p>First section with some text.</p></div>
                <div class="section-b"><p>Second section with even more text content.</p><p>Extra paragraph to increase score.</p><h2>Heading</h2></div>
                <div class="section-c"><p>Third</p></div>
            `;
            const candidates = findMainContentCandidates();
            expect(candidates.length).toBe(3);
            // explicit order: section-b should be first (most paragraphs/headings)
            expect(candidates[0]!.className).toBe('section-b');
            // verify full descending order
            const scores = candidates.map((el) => calculateTextScore(el));
            expect(scores[0]).toBeGreaterThan(scores[1]!);
            expect(scores[1]).toBeGreaterThan(scores[2]!);
        });
    });
});
