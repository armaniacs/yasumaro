// @vitest-environment jsdom
/**
 * helpers.failure-visibility.test.ts — PBI 2026-11-08-09 (1)(2)(3)
 *
 * Pins that deep-scan failures are distinguishable from clean results:
 * - findDeepHosts flags incomplete walks instead of returning a silent empty set
 * - invalid selectors warn once and return [], valid zero-match scans stay silent
 * - skipped shadow subtrees emit a diagnostic log while light-DOM hits survive
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    querySelectorAllDeep,
    findDeepHosts,
    isValidSelector,
} from '../helpers.js';

describe('aiSummaryCleaner helpers failure visibility', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('findDeepHosts', () => {
        it('marks a completed walk as not incomplete', () => {
            document.body.innerHTML = `<div><p>hi</p></div>`;
            const hosts = findDeepHosts(document.body);
            expect(hosts.shadowHosts).toEqual([]);
            expect(hosts.iframes).toEqual([]);
            expect(hosts.incomplete).toBe(false);
        });

        it('flags an incomplete walk when the TreeWalker walk throws', () => {
            document.body.innerHTML = `<div><p>hi</p></div>`;
            vi.spyOn(document, 'createTreeWalker').mockImplementation(() => {
                throw new Error('walk failed');
            });
            const hosts = findDeepHosts(document.body);
            expect(hosts.incomplete).toBe(true);
        });

        it('flags an incomplete walk when no TreeWalker is available', () => {
            const hosts = findDeepHosts({} as unknown as ParentNode);
            expect(hosts.shadowHosts).toEqual([]);
            expect(hosts.iframes).toEqual([]);
            expect(hosts.incomplete).toBe(true);
        });
    });

    describe('querySelectorAllDeep invalid selector', () => {
        it('warns once and returns no matches for an invalid selector', () => {
            document.body.innerHTML = `<div class="x">a</div>`;
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const result = querySelectorAllDeep(document.body, ':::invalid');
            expect(result).toEqual([]);
            expect(warn).toHaveBeenCalledTimes(1);
        });

        it('stays silent for a valid selector with zero matches', () => {
            document.body.innerHTML = `<div class="x">a</div>`;
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const result = querySelectorAllDeep(document.body, '.missing');
            expect(result).toEqual([]);
            expect(warn).not.toHaveBeenCalled();
        });

        it('isValidSelector distinguishes valid from invalid selectors', () => {
            expect(isValidSelector('.x')).toBe(true);
            expect(isValidSelector('div > p')).toBe(true);
            expect(isValidSelector(':::invalid')).toBe(false);
        });
    });

    describe('querySelectorAllDeep shadow skip logging', () => {
        it('logs a diagnostic yet keeps light-DOM hits when a shadow read throws', () => {
            document.body.innerHTML = `<div class="t">light</div>`;
            const host = document.createElement('div');
            host.id = 'broken-host';
            document.body.appendChild(host);
            Object.defineProperty(host, 'shadowRoot', {
                get() {
                    throw new Error('detached');
                },
                configurable: true,
            });
            const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});

            let result: Element[] = [];
            expect(() => {
                result = querySelectorAllDeep(document.body, '.t', {
                    shadowHosts: [host],
                    iframes: [],
                    incomplete: false,
                });
            }).not.toThrow();

            expect(result.map((e) => e.textContent)).toEqual(['light']);
            expect(debug).toHaveBeenCalledTimes(1);
        });

        it('reports an incomplete host detection instead of a silent clean scan', () => {
            // NOTE: jsdom routes querySelector through createTreeWalker, so a
            // blunt createTreeWalker mock would break the query itself. Pass
            // the exact incomplete host set a failed findDeepHosts returns
            // (pinned above) to exercise the consumption point deterministically.
            document.body.innerHTML = `<div class="t">light</div>`;
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

            const result = querySelectorAllDeep(document.body, '.t', {
                shadowHosts: [],
                iframes: [],
                incomplete: true,
            });

            expect(result.map((e) => e.textContent)).toEqual(['light']);
            expect(warn).toHaveBeenCalledTimes(1);
        });
    });
});
