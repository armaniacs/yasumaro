/**
 * domListen.test.ts — shared null-safe listener helper unit tests.
 *
 * Covers the PBI BDD scenarios (null skip, register, teardown) plus
 * multi-listener behavior. Uses Node EventTarget so no DOM env is needed.
 */
import { describe, it, expect } from 'vitest';
import { listen, makeListener } from '../domListen.js';

describe('listen', () => {
    it('skips null and undefined targets without throwing', () => {
        const teardown: Array<() => void> = [];
        expect(() => listen(null, 'click', (() => {}) as EventListener, teardown)).not.toThrow();
        expect(() => listen(undefined, 'click', (() => {}) as EventListener, teardown)).not.toThrow();
        expect(teardown).toHaveLength(0);
    });

    it('registers the handler and fires on dispatch', () => {
        const teardown: Array<() => void> = [];
        const target = new EventTarget();
        let fired = 0;
        listen(target, 'click', (() => {
            fired += 1;
        }) as EventListener, teardown);
        target.dispatchEvent(new Event('click'));
        expect(fired).toBe(1);
        expect(teardown).toHaveLength(1);
    });

    it('teardown removes the handler so it no longer fires', () => {
        const teardown: Array<() => void> = [];
        const target = new EventTarget();
        let fired = 0;
        listen(target, 'click', (() => {
            fired += 1;
        }) as EventListener, teardown);
        for (const off of teardown.splice(0)) off();
        target.dispatchEvent(new Event('click'));
        expect(fired).toBe(0);
    });

    it('makeListener binds teardown so call sites stay 3-arg', () => {
        const teardown: Array<() => void> = [];
        const bound = makeListener(teardown);
        const target = new EventTarget();
        let fired = 0;
        bound(target, 'click', (() => {
            fired += 1;
        }) as EventListener);
        bound(null, 'click', (() => {}) as EventListener);
        target.dispatchEvent(new Event('click'));
        expect(fired).toBe(1);
        expect(teardown).toHaveLength(1);
    });
});
