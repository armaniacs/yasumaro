import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { setElementHtml } from '../htmlFragment.js';

function createBody(html: string): { window: JSDOM['window']; body: HTMLElement } {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`);
    return { window: dom.window, body: dom.window.document.body };
}

describe('setElementHtml', () => {
    it('replaces prior children with the parsed fragment', () => {
        const { body } = createBody('<p>old</p>');
        setElementHtml(body, '<span class="a">new</span>');
        expect(body.querySelector('p')).toBeNull();
        const span = body.querySelector('span');
        expect(span?.className).toBe('a');
        expect(span?.textContent).toBe('new');
    });

    it('parses table fragments in the target context like the innerHTML setter', () => {
        // A DOMParser/body-context parse would drop <tr>/<td>; the innerHTML
        // setter keeps them. The helper must match the setter.
        const { body } = createBody('<table><tbody id="t"></tbody></table>');
        const tbody = body.querySelector('#t') as HTMLElement;
        setElementHtml(tbody, '<tr><td>cell</td></tr>');
        expect(tbody.querySelectorAll('tr')).toHaveLength(1);
        expect(tbody.querySelector('td')?.textContent).toBe('cell');
    });

    it('wraps section targets (thead) so rows survive the parse', () => {
        const { body } = createBody('<table><thead id="h"></thead></table>');
        const thead = body.querySelector('#h') as HTMLElement;
        setElementHtml(thead, '<tr><th>a</th><th>b</th></tr>');
        expect(thead.querySelectorAll('tr')).toHaveLength(1);
        expect(thead.querySelectorAll('th')).toHaveLength(2);
    });

    it('wraps row targets (tr) so cells survive the parse', () => {
        const { body } = createBody('<table><tbody><tr id="r"></tr></tbody></table>');
        const tr = body.querySelector('#r') as HTMLElement;
        setElementHtml(tr, '<td>x</td><td>y</td>');
        expect(tr.querySelectorAll('td')).toHaveLength(2);
        expect(tr.children[1]?.textContent).toBe('y');
    });

    it('wraps cell targets (td) so inline content survives the parse', () => {
        const { body } = createBody('<table><tbody><tr><td id="c"></td></tr></tbody></table>');
        const td = body.querySelector('#c') as HTMLElement;
        setElementHtml(td, '<b>bold</b> text');
        expect(td.querySelector('b')?.textContent).toBe('bold');
        expect(td.textContent).toBe('bold text');
    });

    it('works on a ShadowRoot (DocumentFragment target, body-context parse)', () => {
        const { window, body } = createBody('<div id="host"></div>');
        const host = body.querySelector('#host') as HTMLElement;
        const shadow = host.attachShadow({ mode: 'open' });
        setElementHtml(shadow, '<style>b { color: red; }</style><b>shadow</b>');
        expect(shadow.querySelector('b')?.textContent).toBe('shadow');
        expect((window as unknown as Record<string, unknown>)['__xssRan']).toBeUndefined();
    });

    it('leaves parsed scripts inert and strips them', () => {
        const { window, body } = createBody('<div id="host"></div>');
        const host = body.querySelector('#host') as HTMLElement;
        setElementHtml(host, '<script>window.__xssRan = true<\/script><b>safe</b>');
        expect((window as unknown as { __xssRan?: boolean }).__xssRan).toBeUndefined();
        expect(host.querySelector('b')?.textContent).toBe('safe');
        expect(host.querySelector('script')).toBeNull();
    });

    it('escapes nothing on its own — raw text is caller responsibility', () => {
        const { body } = createBody('<div id="host"></div>');
        const host = body.querySelector('#host') as HTMLElement;
        setElementHtml(host, '<i>kept</i>');
        expect(host.querySelector('i')?.textContent).toBe('kept');
    });
});
