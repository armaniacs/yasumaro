/**
 * innerHTML assignment replacement for UI rendering.
 *
 * WHY not `target.innerHTML = html`: every dynamic innerHTML assignment
 * (and every other HTML-parsing call such as createContextualFragment) is
 * flagged as UNSAFE_VAR_ASSIGNMENT by addons-linter — the same checker AMO
 * runs on upload — and that rule ships with all escape functions disabled.
 *
 * DOMParser is the remaining inert parser: a parsed document never executes
 * scripts, so the result can be adopted with replaceChildren. DOMParser
 * parses in a body context, while the innerHTML setter parses in the target
 * element's context — table-content targets need ancestor wrapping (the same
 * wrap map jQuery's buildFragment uses) or <tr>/<td> fragments would be
 * dropped. Parsed scripts are stripped defensively; all interpolations in
 * caller templates must still be escapeHtml'd.
 */
interface ContextWrap {
    prefix: string;
    suffix: string;
    extract: (doc: Document) => Node[];
}

const TABLE_SECTION_WRAP: ContextWrap = {
    prefix: '<table>',
    suffix: '</table>',
    extract: (doc) => {
        const table = doc.querySelector('table');
        const section = table?.children[0];
        return section ? [...section.childNodes] : [];
    },
};

const TABLE_WRAPPERS: Record<string, ContextWrap> = {
    thead: TABLE_SECTION_WRAP,
    tbody: TABLE_SECTION_WRAP,
    tfoot: TABLE_SECTION_WRAP,
    tr: {
        prefix: '<table><tbody>',
        suffix: '</tbody></table>',
        extract: (doc) => [...doc.querySelector('tr')?.childNodes ?? []],
    },
    td: {
        prefix: '<table><tbody><tr><td>',
        suffix: '</td></tr></tbody></table>',
        extract: (doc) => [...doc.querySelector('td')?.childNodes ?? []],
    },
    th: {
        prefix: '<table><tbody><tr><th>',
        suffix: '</th></tr></tbody></table>',
        extract: (doc) => [...doc.querySelector('th')?.childNodes ?? []],
    },
    col: {
        prefix: '<table><colgroup>',
        suffix: '</colgroup></table>',
        extract: (doc) => [...doc.querySelector('colgroup')?.childNodes ?? []],
    },
};

export function setElementHtml(target: Element | DocumentFragment, html: string): void {
    const doc = target.ownerDocument;
    const Parser =
        doc.defaultView?.DOMParser ??
        (globalThis as unknown as { DOMParser?: typeof DOMParser }).DOMParser;
    if (!Parser) throw new Error('No DOMParser available for safe HTML insertion');

    const tag = 'tagName' in target ? target.tagName.toLowerCase() : '';
    const wrap = TABLE_WRAPPERS[tag];
    const parsed = new Parser().parseFromString(
        wrap ? wrap.prefix + html + wrap.suffix : html,
        'text/html',
    );
    for (const script of [...parsed.querySelectorAll('script')]) script.remove();

    const nodes = wrap ? wrap.extract(parsed) : [...parsed.body.childNodes];
    target.replaceChildren(...nodes);
}
