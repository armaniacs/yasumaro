// @vitest-environment jsdom
/**
 * helpers.deep-shortcircuit.test.ts — PBI 05 fix-qsa-deep-shortcircuit
 *
 * Proves the short-circuit guarantee:
 * - full-subtree '*' enumeration happens at most ONCE per root (host detection),
 *   never per rule / per recursion level;
 * - with precomputed (empty) hosts, zero '*' scans occur;
 * - recursion descends only into detected shadow hosts / same-origin iframes;
 * - cross-origin iframes are swallowed as before;
 * - the cleanse entry point detects hosts exactly once for all rules.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
    querySelectorAllDeep,
    collectElementsDeep,
    findDeepHosts,
    primeDeepHosts,
} from '../helpers.js';
import { cleanseAISummaryContent } from '../index.js';

interface StarCounts {
    element: number;
    shadow: number;
    doc: number;
}

function installStarSpies(): { counts: () => StarCounts; restore: () => void } {
    const elSpy = vi.spyOn(Element.prototype, 'querySelectorAll');
    const shadowProto = (globalThis as unknown as { ShadowRoot?: object })
        .ShadowRoot as unknown as { prototype?: object } | undefined;
    const shadowSpy =
        shadowProto?.prototype &&
        'querySelectorAll' in (shadowProto.prototype as object)
            ? vi.spyOn(
                    shadowProto.prototype as Element,
                    'querySelectorAll' as never,
                )
            : null;
    const docSpy = vi.spyOn(Document.prototype, 'querySelectorAll');
    const count = (spy: { mock: { calls: unknown[][] } } | null): number =>
        spy?.mock.calls.filter((c) => c[0] === '*').length ?? 0;
    return {
        counts: () => ({
            element: count(elSpy as never),
            shadow: count(shadowSpy as never),
            doc: count(docSpy as never),
        }),
        restore: () => {
            elSpy.mockRestore();
            (shadowSpy as { mockRestore?: () => void } | null)?.mockRestore?.();
            docSpy.mockRestore();
        },
    };
}

function totalStars(c: StarCounts): number {
    return c.element + c.shadow + c.doc;
}

describe('PBI 05 querySelectorAllDeep short-circuit', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('findDeepHosts: plain DOM yields empty hosts with a single scan', () => {
        document.body.innerHTML = `<div><p>hi</p></div><nav>nav</nav>`;
        const spies = installStarSpies();
        const hosts = findDeepHosts(document.body);
        const counts = spies.counts();
        spies.restore();

        expect(hosts.shadowHosts).toEqual([]);
        expect(hosts.iframes).toEqual([]);
        expect(totalStars(counts)).toBe(1);
    });

    it('no shadow/iframe: without hosts, exactly one host-detection scan, result matches plain qSA', () => {
        document.body.innerHTML =
            `<div class="x">a</div>` +
            `<div><span class="x">b</span></div>` +
            Array.from({ length: 50 }, (_, i) => `<div>plain ${i}</div>`).join('') +
            `<footer>f</footer>`;
        const spies = installStarSpies();
        const result = querySelectorAllDeep(document.body, '.x');
        const counts = spies.counts();
        const expected = Array.from(document.body.querySelectorAll('.x'));
        spies.restore();

        expect(result.length).toBe(2);
        expect(result.map((e) => e.textContent)).toEqual(
            expected.map((e) => (e as Element).textContent),
        );
        // One scan for host detection; no per-level / per-element enumeration.
        expect(totalStars(counts)).toBe(1);
        expect(counts.element).toBe(1);
    });

    it('no shadow/iframe: with precomputed empty hosts, zero star scans', () => {
        document.body.innerHTML = `<div class="x">a</div><div class="x">b</div>`;
        const hosts = findDeepHosts(document.body);
        expect(hosts.shadowHosts).toEqual([]);
        expect(hosts.iframes).toEqual([]);

        const spies = installStarSpies();
        const result = querySelectorAllDeep(document.body, '.x', hosts);
        const counts = spies.counts();
        spies.restore();

        expect(result.length).toBe(2);
        expect(totalStars(counts)).toBe(0);
    });

    it('two open shadowRoots: internals found, recursion limited to hosts', () => {
        document.body.innerHTML =
            `<div class="t">light</div>` +
            Array.from({ length: 50 }, (_, i) => `<div>plain ${i}</div>`).join('');
        for (let i = 0; i < 2; i++) {
            const host = document.createElement('div');
            host.id = `host-${i}`;
            document.body.appendChild(host);
            const shadow = host.attachShadow({ mode: 'open' });
            shadow.innerHTML = `<span class="t">shadow-${i}</span>`;
        }

        const spies = installStarSpies();
        const result = querySelectorAllDeep(document.body, '.t');
        const counts = spies.counts();
        spies.restore();

        expect(result.length).toBe(3);
        expect(result.map((e) => e.textContent).sort()).toEqual([
            'light',
            'shadow-0',
            'shadow-1',
        ]);
        // One body-level detection scan + one scan per shadow subtree.
        // The 50+ plain divs are never enumerated per level.
        expect(counts.element).toBe(1);
        expect(counts.shadow).toBe(2);
    });

    it('same-origin iframe: inner elements found (existing mock pattern)', () => {
        const iframe = document.createElement('iframe');
        document.body.appendChild(iframe);
        const iframeDoc = document.implementation.createHTMLDocument('iframeDoc');
        iframeDoc.body.innerHTML = `<div class="ad-banner">iframe ad</div>`;
        Object.defineProperty(iframe, 'contentDocument', {
            value: iframeDoc,
            writable: true,
            configurable: true,
        });

        const result = querySelectorAllDeep(document.body, '.ad-banner');
        expect(result.length).toBe(1);
        expect(result[0].textContent).toBe('iframe ad');
    });

    it('cross-origin iframe: SecurityError swallowed, light DOM still returned', () => {
        document.body.innerHTML = `<div class="ad-banner">light ad</div>`;
        const iframe = document.createElement('iframe');
        document.body.appendChild(iframe);
        Object.defineProperty(iframe, 'contentDocument', {
            get() {
                throw new Error('SecurityError: cross-origin');
            },
            configurable: true,
        });

        let result: Element[] = [];
        expect(() => {
            result = querySelectorAllDeep(document.body, '.ad-banner');
        }).not.toThrow();
        expect(result.length).toBe(1);
        expect(result[0].textContent).toBe('light ad');
    });

    it('closed shadowRoots stay skipped', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const shadow = host.attachShadow({ mode: 'closed' });
        shadow.innerHTML = `<div class="ad-banner">closed ad</div>`;

        const hosts = findDeepHosts(document.body);
        expect(hosts.shadowHosts).toEqual([]);
        const result = querySelectorAllDeep(document.body, '.ad-banner');
        expect(result.length).toBe(0);
    });

    it('collectElementsDeep alias still exposes the new signature', () => {
        expect(collectElementsDeep).toBe(querySelectorAllDeep);
        document.body.innerHTML = `<div class="x">a</div>`;
        const hosts = findDeepHosts(document.body);
        expect(collectElementsDeep(document.body, '.x', hosts).length).toBe(1);
    });

    it('entry point: host detection runs once for all rules; later deep scans reuse the cache', () => {
        const root = document.createElement('div');
        root.innerHTML =
            `<div class="ad-banner">ad</div>`.repeat(5) + `<p>real body text</p>`;
        document.body.appendChild(root);

        const spies = installStarSpies();
        // In-place contract (matches the extractor path): prime + rules run on
        // the same root, so the primed cache is actually reused.
        cleanseAISummaryContent(root, { alreadyCloned: true });
        const afterCleanse = spies.counts();

        // Simulate N subsequent rule scans over the same root.
        for (let i = 0; i < 10; i++) {
            querySelectorAllDeep(root, '.ad-banner');
        }
        const afterRules = spies.counts();
        // primeDeepHosts is exported for entry points that compute hosts eagerly.
        primeDeepHosts(root);
        spies.restore();

        // Exactly one full-subtree scan for the whole cleanse + 10 rule scans.
        expect(totalStars(afterCleanse)).toBe(1);
        expect(totalStars(afterRules)).toBe(1);
    });
});
