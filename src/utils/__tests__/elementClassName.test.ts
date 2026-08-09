/**
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { getClassNameString, getLowerClassName } from '../elementClassName.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

describe('getClassNameString', () => {
    it('returns the class attribute of an HTML element', () => {
        const el = document.createElement('div');
        el.className = 'Main-Content sidebar';
        expect(getClassNameString(el)).toBe('Main-Content sidebar');
    });

    it('returns an empty string when the HTML element has no class', () => {
        const el = document.createElement('div');
        expect(getClassNameString(el)).toBe('');
    });

    it('returns the base value for an SVG element whose className is an SVGAnimatedString', () => {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', 'icon icon-nav');
        expect(getClassNameString(svg)).toBe('icon icon-nav');
    });

    it('returns an empty string for an SVG element with no class attribute', () => {
        const svg = document.createElementNS(SVG_NS, 'path');
        expect(getClassNameString(svg)).toBe('');
    });
});

describe('getLowerClassName', () => {
    it('lowercases HTML class names', () => {
        const el = document.createElement('div');
        el.className = 'Sidebar NAV';
        expect(getLowerClassName(el)).toBe('sidebar nav');
    });

    it('lowercases SVG class names without throwing', () => {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', 'Ad-Banner');
        expect(() => getLowerClassName(svg)).not.toThrow();
        expect(getLowerClassName(svg)).toBe('ad-banner');
    });
});
