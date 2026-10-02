/**
 * aiSummaryCleansingThresholdRanges.test.ts
 *
 * The threshold sliders are wired by a hand-written table, and the sliders
 * themselves live in a hand-written HTML file. Nothing connects the two, so the
 * two ways they can drift apart both look fine in review and both cost the user
 * a lost setting:
 *
 *   - a slider added to the page with no table row binds nothing: no `input`
 *     mirror and no `change` write, so the moved value is discarded when the
 *     page is closed without pressing save;
 *   - a table row for a slider the page no longer renders is inert —
 *     `getElementById` returns null and nothing can move it.
 *
 * Reading the real HTML makes both directions mechanical: the rendered sliders
 * are enumerated from the file, so a slider added there fails here instead of
 * silently going unsaved.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLEANSING_THRESHOLD_RANGES } from '../aiSummaryCleansingSettingsV2.js';

const OPTIONS_HTML_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../entrypoints/options/index.html');
const OPTIONS_HTML = readFileSync(OPTIONS_HTML_PATH, 'utf-8');

/** The panel this module wires; sliders outside it belong to another module. */
const CLEANSING_PANEL_ID = 'panel-ai-summary-cleansing';

/** The panel's own markup, from its opening tag to the next `</section>`. */
function cleansingPanelMarkup(): string {
    const open = OPTIONS_HTML.indexOf(`<section id="${CLEANSING_PANEL_ID}"`);
    expect(open).toBeGreaterThan(-1);
    const close = OPTIONS_HTML.indexOf('</section>', open);
    expect(close).toBeGreaterThan(open);
    return OPTIONS_HTML.slice(open, close);
}

const PANEL_MARKUP = cleansingPanelMarkup();

/** Every `<input type="range">` id in the markup, in document order. */
function renderedRangeIds(markup: string): string[] {
    return [...markup.matchAll(/<input\b[^>]*\btype="range"[^>]*>/g)].map(match => {
        const id = /\bid="([^"]+)"/.exec(match[0])?.[1];
        expect(id, `range input without an id: ${match[0]}`).toBeTruthy();
        return id!;
    });
}

const RENDERED_IDS = renderedRangeIds(PANEL_MARKUP);
const WIRED_IDS = CLEANSING_THRESHOLD_RANGES.map(row => row.id);

describe('CLEANSING_THRESHOLD_RANGES', () => {
    describe('correspondence with the cleansing panel in entrypoints/options/index.html', () => {
        it('binds every range input the panel renders', () => {
            const unwired = RENDERED_IDS.filter(id => !WIRED_IDS.includes(id));

            expect(unwired).toEqual([]);
        });

        it('has no row for a slider the panel no longer renders', () => {
            const inert = WIRED_IDS.filter(id => !RENDERED_IDS.includes(id));

            expect(inert).toEqual([]);
        });

        it('wires each slider exactly once', () => {
            expect(WIRED_IDS).toHaveLength(new Set(WIRED_IDS).size);
        });

        it('renders a display element for every wired slider', () => {
            const mirrorless = CLEANSING_THRESHOLD_RANGES
                .filter(row => !PANEL_MARKUP.includes(`id="${row.valId}"`))
                .map(row => row.valId);

            expect(mirrorless).toEqual([]);
        });

        it('reads the enumeration it asserts against, not an empty set', () => {
            // A regex that stops matching leaves both directions above vacuously
            // green, so the enumeration itself is pinned.
            expect(RENDERED_IDS).toContain('ai-summary-cleansing-fallback-ratio');
            expect(RENDERED_IDS).toContain('ai-summary-cleansing-fallback-min-bytes');
        });
    });
});