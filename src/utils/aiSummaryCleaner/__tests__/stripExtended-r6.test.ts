/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  stripFixedElements,
  stripRecommendSections,
  stripSnsPromoElements,
  stripPopupElements,
  stripCookieConsentElements,
  stripPlatformNoise,
  stripTextDensityElements,
  stripShortSequenceElements,
  stripSymbolLineElements,
  stripLinkOnlyParagraphs,
  stripEnhancedHiddenElements,
  stripEmptyElements,
  stripJPLayoutPatterns,
  stripJPNavigationPatterns,
  stripAuthorMetaElements,
  stripAffiliateElements,
  stripSpeechBubbles,
} from '../stripExtended.js';

describe('stripExtended - R6 remaining branches (|| fallbacks, child null, counted)', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });
  afterEach(() => {
    root.remove();
    vi.restoreAllMocks();
  });

  it('covers textContent || fallback in collectCookie (textContent null)', () => {
    const p = document.createElement('p');
    Object.defineProperty(p, 'textContent', { get: () => null, configurable: true });
    // Need to be candidate for collect: p tag
    root.appendChild(p);
    // Should not throw and not remove
    expect(stripCookieConsentElements(root)).toBe(0);
  });

  it('covers textContent || fallback in stripTextDensity (elem null)', () => {
    const div = document.createElement('div');
    Object.defineProperty(div, 'textContent', { get: () => null, configurable: true });
    root.appendChild(div);
    expect(stripTextDensityElements(root, 70)).toBe(0);
  });

  it('covers textContent || fallback in stripShortSequence', () => {
    const p = document.createElement('p');
    Object.defineProperty(p, 'textContent', { get: () => null, configurable: true });
    root.appendChild(p);
    expect(stripShortSequenceElements(root, 30, 5)).toBe(0);
  });

  it('covers textContent || fallback in stripSymbolLine', () => {
    const p = document.createElement('p');
    Object.defineProperty(p, 'textContent', { get: () => null, configurable: true });
    root.appendChild(p);
    expect(stripSymbolLineElements(root)).toBe(0);
  });

  it('covers p.textContent || fallback in stripLinkOnlyParagraphs', () => {
    const p = document.createElement('p');
    Object.defineProperty(p, 'textContent', { get: () => null, configurable: true });
    p.innerHTML = '<a href="#">x</a>';
    root.appendChild(p);
    expect(stripLinkOnlyParagraphs(root, 50)).toBe(0);
  });

  it('covers child.textContent || fallback in stripLinkOnlyParagraphs second loop', () => {
    const p = document.createElement('p');
    p.innerHTML = '<a href="#">Link</a><span></span>';
    const span = p.querySelector('span') as HTMLElement;
    Object.defineProperty(span, 'textContent', { get: () => null, configurable: true });
    root.appendChild(p);
    expect(stripLinkOnlyParagraphs(root, 50)).toBe(0);
  });

  it('covers style || fallback in stripEnhancedHidden (no style)', () => {
    const div = document.createElement('div');
    div.setAttribute('hidden', '');
    // no style attribute, getAttribute returns null -> fallback '' used in opacity check
    root.appendChild(div);
    expect(stripEnhancedHiddenElements(root)).toBe(1);
  });

  it('covers elem.textContent || fallback in stripJPNavigation (text)', () => {
    const div = document.createElement('div');
    Object.defineProperty(div, 'textContent', { get: () => null, configurable: true });
    div.className = 'global-nav';
    root.appendChild(div);
    // Should still remove via selector, fallback not needed for selector path, but second loop uses textContent
    expect(stripJPNavigationPatterns(root)).toBe(1);
  });

  it('covers elem.textContent || fallback in stripAuthorMeta', () => {
    const div = document.createElement('div');
    Object.defineProperty(div, 'textContent', { get: () => null, configurable: true });
    root.appendChild(div);
    expect(stripAuthorMetaElements(root)).toBe(0);
  });

  it('covers el.textContent || fallback in stripSpeechBubbles (speechText parts)', () => {
    root.innerHTML = '<div class="speech-balloon"><div class="balloon-text"></div></div>';
    const el = root.querySelector('.balloon-text') as HTMLElement;
    Object.defineProperty(el, 'textContent', { get: () => null, configurable: true });
    expect(stripSpeechBubbles(root)).toBe(1); // fallback to all text (empty) then remove
  });

  it('covers container.textContent || fallback in stripSpeechBubbles fallback', () => {
    const c = document.createElement('div');
    c.className = 'speech-balloon';
    Object.defineProperty(c, 'textContent', { get: () => null, configurable: true });
    root.appendChild(c);
    expect(stripSpeechBubbles(root)).toBe(1); // empty balloon removed
  });

  it('covers counted.has true for stripShortSequence via mock duplicate', () => {
    const p1 = document.createElement('p');
    p1.textContent = 'a';
    const p2 = document.createElement('p');
    p2.textContent = 'b';
    root.appendChild(p1);
    root.appendChild(p2);
    vi.spyOn(root, 'querySelectorAll').mockImplementation((sel: string) => {
      if (sel === 'p, span, li, div') {
        const list = [p1, p1, p2] as unknown as NodeListOf<Element>;
        (list as any).forEach = Array.prototype.forEach.bind(list);
        return list;
      }
      return (Element.prototype.querySelectorAll as any).call(root, sel);
    });
    // p1 duplicate should be skipped via counted.has
    expect(stripShortSequenceElements(root, 30, 5)).toBe(0);
  });

  it('covers counted.has true for stripEmptyElements via mock duplicate', () => {
    const div = document.createElement('div');
    root.appendChild(div);
    vi.spyOn(root, 'querySelectorAll').mockImplementation((sel: string) => {
      if (sel === 'div, span, p, section, article') {
        const list = [div, div] as unknown as NodeListOf<Element>;
        (list as any).forEach = Array.prototype.forEach.bind(list);
        return list;
      }
      return (Element.prototype.querySelectorAll as any).call(root, sel);
    });
    expect(stripEmptyElements(root)).toBe(1);
  });

  it('covers childHasContent and allEmpty branches in stripEmptyElements', () => {
    // childHasContent true via text
    root.innerHTML = '<div><span>hello</span></div>';
    expect(stripEmptyElements(root)).toBe(0); // parent not empty because child has text
    root.innerHTML = '';
    // allEmpty true
    root.innerHTML = '<div><span></span><p></p></div>';
    expect(stripEmptyElements(root)).toBe(3);
    root.innerHTML = '';
    // childHasContent via img
    const div = document.createElement('div');
    div.innerHTML = '<span><img src="x.jpg"></span>';
    root.appendChild(div);
    expect(stripEmptyElements(root)).toBe(0);
  });

  it('covers safeReplace false for speech fallback via body protection', () => {
    root.innerHTML = '<div data-ow-body-protected="true"><div class="speech-balloon"><div>fallback</div></div></div>';
    expect(stripSpeechBubbles(root)).toBe(0);
  });

  it('covers yahoo fixed true via mock bypassing earlier counted', () => {
    // Mock fixedElements to return empty, then yahoo should be considered
    const yahoo = document.createElement('div');
    yahoo.className = 'yahoo-news-test';
    yahoo.setAttribute('style', 'position: fixed;');
    root.appendChild(yahoo);
    const originalQS = Element.prototype.querySelectorAll;
    vi.spyOn(root, 'querySelectorAll').mockImplementation(function (this: Element, sel: string) {
      if (sel.includes('position: fixed') && sel.includes('position:fixed')) {
        // Return empty for first two queries to avoid duplicate
        if (sel.includes('yahoo-news') || sel.includes('game8')) {
          // For yahoo/game8 selectors, return yahoo
          return originalQS.call(root, sel) as any;
        }
        const empty = [] as unknown as NodeListOf<Element>;
        (empty as any).forEach = Array.prototype.forEach.bind(empty);
        return empty;
      }
      return originalQS.call(root, sel) as any;
    });
    // This is complex mock; just verify yahoo branch can be hit by checking that stripFixedElements still removes via yahoo path
    // Simpler: directly test that yahoo element is removed even when mocked
    // We'll just ensure no error
    expect(stripFixedElements(root)).toBe(1);
  });
});
