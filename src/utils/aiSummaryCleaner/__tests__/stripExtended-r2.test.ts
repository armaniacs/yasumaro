/**
 * @vitest-environment jsdom
 */
/**
 * stripExtended-r2.test.ts — additional branch coverage for stripExtended.ts.
 * Covers: multi-match counting across patterns, isFixedOrSticky/isLikelyAd/isLikelyPopup
 * /isPlatformNoise returning false branches, text density short-circuit (<50 chars),
 * short-sequence intermediate tracking, symbol-line mixed content, link-only paragraphs
 * with direct text nodes, enhanced-hidden opacity without fixed/sticky, empty elements
 * with all-empty children, and the long-text skip in author elements.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  stripFixedElements,
  stripRecommendSections,
  stripPaginationElements,
  stripSnsPromoElements,
  stripPopupElements,
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
} from '../stripExtended.js';

describe('stripExtended - R2 branch coverage', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
  });

  describe('stripFixedElements — non-matching guards', () => {
    it('skips Yahoo News elements that are not fixed/sticky', () => {
      root.innerHTML = '<div class="yahoo-news-headerWrap" style="position: relative;">Yahoo</div>';
      const count = stripFixedElements(root);
      expect(count).toBe(0);
    });

    it('skips Game8 elements that are not fixed/sticky', () => {
      root.innerHTML = '<div class="game8-headerMenu" style="position: relative;">Game8</div>';
      const count = stripFixedElements(root);
      expect(count).toBe(0);
    });
  });

  describe('stripRecommendSections — multi-pattern dedup', () => {
    it('does not double-count elements matched by multiple patterns', () => {
      root.innerHTML = '<div class="carousel recommend-list">Multi</div>';
      const count = stripRecommendSections(root);
      expect(count).toBe(1);
    });
  });

  describe('stripSnsPromoElements — isLikelyAd false', () => {
    it('skips elements with data-a-divination that are not ads', () => {
      root.innerHTML = '<div data-a-divination="true" class="normal">No ad</div>';
      const count = stripSnsPromoElements(root);
      expect(count).toBe(0);
    });
  });

  describe('stripPopupElements — isLikelyPopup false', () => {
    it('skips cookie elements that are not popup-like', () => {
      root.innerHTML = '<div id="cookietime" class="normal-text">Cookie time</div>';
      const count = stripPopupElements(root);
      expect(count).toBe(0);
    });

    it('skips dialogs without [open] attribute', () => {
      root.innerHTML = '<dialog>Not open</dialog>';
      const count = stripPopupElements(root);
      expect(count).toBe(0);
    });
  });

  describe('stripPlatformNoise — isPlatformNoise false', () => {
    it('skips number/id class elements that are not platform noise', () => {
      root.innerHTML = '<div class="header-number">Number</div>';
      const count = stripPlatformNoise(root);
      expect(count).toBe(0);
    });
  });

  describe('stripTextDensityElements — short-circuit < 50 chars', () => {
    it('skips elements with total text under 50 chars', () => {
      root.innerHTML = '<ul><li><a href="#">Short</a></li></ul>';
      const count = stripTextDensityElements(root, 70);
      expect(count).toBe(0);
    });

    it('skips already-counted elements (nested same-element dedup)', () => {
      root.innerHTML = '<div><div class="some-wrap"><div><p>Text content here that brings the total over fifty characters easily for the test.</p></div></div></div>';
      const count = stripTextDensityElements(root, 70);
      expect(count).toBe(0);
    });
  });

  describe('stripShortSequenceElements — intermediate tracking', () => {
    it('tracks consecutive short elements per parent', () => {
      // Two different parents each with 3 short elements (< seqCount=5 → none removed)
      root.innerHTML = '<div><p>AA</p><p>BB</p><p>CC</p></div><section><p>XX</p><p>YY</p><p>ZZ</p></section>';
      const count = stripShortSequenceElements(root, 30, 5);
      expect(count).toBe(0);
    });

    it('resets consecutive count when parent changes', () => {
      root.innerHTML = '<div><p>A1</p><p>A2</p><p>A3</p><p>A4</p></div><section><p>B1</p><p>B2</p><p>B3</p><p>B4</p></section>';
      const count = stripShortSequenceElements(root, 30, 4);
      // Each parent: 4th element is removed → 2 total
      expect(count).toBe(2);
    });
  });

  describe('stripSymbolLineElements — mixed content', () => {
    it('does not remove lines with symbols and text', () => {
      root.innerHTML = '<p>| Some text</p><p>► Item</p>';
      const count = stripSymbolLineElements(root);
      expect(count).toBe(0);
    });
  });

  describe('stripLinkOnlyParagraphs — direct text nodes', () => {
    it('detects direct text nodes outside links', () => {
      root.innerHTML = '<p><a href="#">Link</a> extra text</p>';
      const count = stripLinkOnlyParagraphs(root, 50);
      expect(count).toBe(0);
    });

    it('removes paragraph with only links and text nodes from whitespace', () => {
      root.innerHTML = '<p><a href="#">Link1</a> <a href="#">Link2</a></p>';
      const count = stripLinkOnlyParagraphs(root, 50);
      expect(count).toBe(1);
    });
  });

  describe('stripEnhancedHiddenElements — opacity without fixed/sticky', () => {
    it('does not remove opacity:0 elements without fixed/sticky', () => {
      root.innerHTML = '<div style="opacity: 0;">Not removed</div>';
      const count = stripEnhancedHiddenElements(root);
      expect(count).toBe(0);
    });

    it('removes opacity:0 with fixed position', () => {
      root.innerHTML = '<div style="opacity: 0; position: fixed;">Removed</div>';
      const count = stripEnhancedHiddenElements(root);
      expect(count).toBe(1);
    });

    it('removes opacity:0 with sticky position', () => {
      root.innerHTML = '<div style="opacity: 0; position: sticky;">Removed</div>';
      const count = stripEnhancedHiddenElements(root);
      expect(count).toBe(1);
    });
  });

  describe('stripEmptyElements — all-empty children branch', () => {
    it('removes parent when all children are empty', () => {
      root.innerHTML = '<div><span></span><p></p></div>';
      const count = stripEmptyElements(root);
      expect(count).toBe(3); // div + span + p
    });

    it('does not remove parent when a child has content', () => {
      root.innerHTML = '<div><span></span><p>Text</p></div>';
      const count = stripEmptyElements(root);
      expect(count).toBe(1); // only span
    });

    it('does not remove elements with images', () => {
      root.innerHTML = '<div><img src="x.jpg"></div>';
      const count = stripEmptyElements(root);
      expect(count).toBe(0);
    });
  });

  describe('stripJPLayoutPatterns — custom patterns missing', () => {
    it('uses custom patterns from parameter', () => {
      root.innerHTML = '<div class="my-custom">Custom</div>';
      const count = stripJPLayoutPatterns(root, ['my-custom']);
      expect(count).toBe(1);
    });
  });

  describe('stripJPNavigationPatterns — keyword matching', () => {
    it('finds first matching keyword only (break after match)', () => {
      root.innerHTML = '<div> Site Menu and ページメニュー both present</div>';
      const count = stripJPNavigationPatterns(root);
      expect(count).toBe(1);
    });

    it('does not remove normal text without keywords', () => {
      root.innerHTML = '<p>Just regular content here nothing special.</p>';
      const count = stripJPNavigationPatterns(root);
      expect(count).toBe(0);
    });
  });

  describe('stripAuthorMetaElements — long text skip', () => {
    it('skips elements with text longer than 200 chars', () => {
      root.innerHTML = `<div>${'A'.repeat(201)} この記事書いた人</div>`;
      const count = stripAuthorMetaElements(root);
      expect(count).toBe(0);
    });

    it('does not double-count elements with multiple keyword matches', () => {
      root.innerHTML = '<div class="author-profile writer-bio">Author</div>';
      const count = stripAuthorMetaElements(root);
      expect(count).toBe(1);
    });
  });
});
