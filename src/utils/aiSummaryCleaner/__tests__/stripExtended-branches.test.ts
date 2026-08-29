/**
 * @vitest-environment jsdom
 */

/**
 * stripExtended-branches.test.ts
 * Targets uncovered branches in aiSummaryCleaner/stripExtended.ts:
 * - "already counted" dedup paths (selector overlap between multiple querySelectorAll passes)
 * - safeRemoveElement/safeReplaceWithText returning false due to body protection
 * - various boundary conditions (empty text, no children, no ancestors, etc.)
 */

import { describe, it, expect } from 'vitest';
import {
  stripFixedElements,
  stripRecommendSections,
  stripPaginationElements,
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
  stripNewsMediaPatterns,
  stripEcSitePatterns,
  stripQaSitePatterns,
  stripVideoSitePatterns,
} from '../stripExtended.js';

const PROTECT_ATTR = 'data-ow-body-protected';

function setHtml(html: string): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
}

describe('stripExtended.ts branch coverage', () => {
  describe('stripFixedElements dedup + protection', () => {
    it('skips elements already counted by an earlier selector pass (fixed+sticky overlap)', () => {
      // element matches BOTH position:fixed and fixed-video class selectors
      const root = setHtml(`<div style="position: fixed;" class="fixed-video">a</div>`);
      const removed = stripFixedElements(root);
      expect(removed).toBe(1);
    });

    it('skips yahoo-news element that is not fixed/sticky', () => {
      const root = setHtml(`<div class="yahoo-news">not fixed</div>`);
      const removed = stripFixedElements(root);
      expect(removed).toBe(0);
    });

    it('skips game8 element that is not fixed/sticky', () => {
      const root = setHtml(`<div class="game8">not fixed</div>`);
      const removed = stripFixedElements(root);
      expect(removed).toBe(0);
    });

    it('does not remove body-protected fixed elements', () => {
      const root = setHtml(`<div style="position: fixed;" ${PROTECT_ATTR}="true">protected</div>`);
      const removed = stripFixedElements(root);
      expect(removed).toBe(0);
    });
  });

  describe('stripRecommendSections dedup + protection', () => {
    it('skips duplicate matches across recommend/relation/ranking selectors', () => {
      const root = setHtml(`
        <div class="carousel relation-module rankingList">dup</div>
      `);
      const removed = stripRecommendSections(root);
      expect(removed).toBe(1);
    });

    it('removes a Game8-specific "RankingBox" element not caught by the generic recommend selector', () => {
      const root = setHtml(`<div class="RankingBox">standalone ranking</div>`);
      const removed = stripRecommendSections(root);
      expect(removed).toBe(1);
    });

    it('does not remove body-protected recommend elements', () => {
      const root = setHtml(`<div class="carousel" ${PROTECT_ATTR}="true">x</div>`);
      const removed = stripRecommendSections(root);
      expect(removed).toBe(0);
    });
  });

  describe('stripPaginationElements protection', () => {
    it('does not remove body-protected pagination elements', () => {
      const root = setHtml(`<div class="pagination" ${PROTECT_ATTR}="true">x</div>`);
      const removed = stripPaginationElements(root);
      expect(removed).toBe(0);
    });
  });

  describe('stripSnsPromoElements dedup + protection', () => {
    it('skips duplicates across sns-promo/testid/aria-label/ad-holder selectors', () => {
      const root = setHtml(`
        <div class="sponsored" data-testid="promotedIndicator" aria-label="Trending now" data-a-divination="ad-something">dup</div>
      `);
      const removed = stripSnsPromoElements(root);
      expect(removed).toBe(1);
    });

    it('removes a standalone AdHolder element that looks like an ad', () => {
      const root = setHtml(`<div class="AdHolder">sponsored content here</div>`);
      const removed = stripSnsPromoElements(root);
      expect(removed).toBe(1);
    });

    it('skips ad-holder element that does not look like an ad', () => {
      const root = setHtml(`<div id="header">not an ad</div>`);
      const removed = stripSnsPromoElements(root);
      expect(removed).toBe(0);
    });

    it('does not remove body-protected sns promo element', () => {
      const root = setHtml(`<div class="sponsored" ${PROTECT_ATTR}="true">x</div>`);
      const removed = stripSnsPromoElements(root);
      expect(removed).toBe(0);
    });
  });

  describe('stripPopupElements dedup + protection', () => {
    it('skips duplicate popup selector and dialog[open] matches', () => {
      const root = setHtml(`<dialog open class="popup">dup</dialog>`);
      const removed = stripPopupElements(root);
      expect(removed).toBe(1);
    });

    it('removes a standalone cookie-banner element (not in POPUP_SELECTOR) detected via isLikelyPopup fallback', () => {
      // "cookiebar" contains neither any POPUP_PATTERNS keyword nor "cookie-banner"/"consent" verbatim,
      // but its id contains "cookie" so it reaches the generic fallback block; isLikelyPopup matches
      // because its className includes "cookie".
      const root = setHtml(`<div class="cookiebar-x">Accept cookies</div>`);
      const removed = stripPopupElements(root);
      expect(removed).toBe(1);
    });

    it('skips cookie/consent element that is not likely a popup', () => {
      const root = setHtml(`<div id="cookie-recipe">Grandma's chocolate chip cookie recipe here...</div>`);
      const removed = stripPopupElements(root);
      expect(removed).toBe(0);
    });

    it('does not remove body-protected popup element', () => {
      const root = setHtml(`<div class="modal" ${PROTECT_ATTR}="true">x</div>`);
      const removed = stripPopupElements(root);
      expect(removed).toBe(0);
    });
  });

  describe('stripCookieConsentElements protection', () => {
    it('removes a non-protected cookie consent text element', () => {
      const text = 'Please review our Cookie consent settings. Marketing Cookies are always active on this site by default.';
      const root = setHtml(`<p>${text}</p>`);
      const removed = stripCookieConsentElements(root);
      expect(removed).toBe(1);
    });

    it('does not remove body-protected cookie consent text element', () => {
      const text = 'Please review our Cookie consent settings. Marketing Cookies are always active on this site by default.';
      const root = setHtml(`<p ${PROTECT_ATTR}="true">${text}</p>`);
      const removed = stripCookieConsentElements(root);
      expect(removed).toBe(0);
    });

    it('skips element whose text exceeds 1200 chars', () => {
      const text = 'Cookie consent ' + 'x'.repeat(1250);
      const root = setHtml(`<div>${text}</div>`);
      const removed = stripCookieConsentElements(root);
      expect(removed).toBe(0);
    });

    it('skips element whose text is shorter than 10 chars', () => {
      const root = setHtml(`<p>hi</p>`);
      const removed = stripCookieConsentElements(root);
      expect(removed).toBe(0);
    });

    it('skips element containing 3+ nested p/article/section elements (looks like real content, not a banner)', () => {
      const root = setHtml(`
        <div>
          Cookie consent settings text that matches the pattern here today.
          <p>one</p><p>two</p><p>three</p>
        </div>
      `);
      const removed = stripCookieConsentElements(root);
      expect(removed).toBe(0);
    });
  });

  describe('stripPlatformNoise dedup + protection', () => {
    it('skips #comments element already counted by the platform selector pass', () => {
      const root = setHtml(`<div id="comments" class="tweet">already matched by platform selector</div>`);
      const removed = stripPlatformNoise(root);
      expect(removed).toBe(1);
    });

    it('skips duplicate matches across platform/comments/postnum selectors', () => {
      const root = setHtml(`<div id="comments" class="postnum">123</div>`);
      const removed = stripPlatformNoise(root);
      expect(removed).toBe(1);
    });

    it('removes postnum-like element that is platform noise (id contains "related")', () => {
      const root = setHtml(`<div id="related-thread" class="postnum">123</div>`);
      const removed = stripPlatformNoise(root);
      expect(removed).toBe(1);
    });

    it('skips postnum-like element that is not platform noise', () => {
      const root = setHtml(`<div class="idle-content">some long descriptive text content here</div>`);
      const removed = stripPlatformNoise(root);
      expect(removed).toBe(0);
    });

    it('does not remove body-protected platform noise element', () => {
      const root = setHtml(`<div class="ytp-x" ${PROTECT_ATTR}="true">x</div>`);
      const removed = stripPlatformNoise(root);
      expect(removed).toBe(0);
    });
  });

  describe('stripTextDensityElements branch coverage', () => {
    it('skips elements below the 50 char text length threshold', () => {
      const root = setHtml(`<ul><li><a href="#">short</a></li></ul>`);
      const removed = stripTextDensityElements(root);
      expect(removed).toBe(0);
    });

    it('skips elements whose link ratio is below threshold', () => {
      const longText = 'x'.repeat(80);
      const root = setHtml(`<div><a href="#">link</a>${longText}</div>`);
      const removed = stripTextDensityElements(root);
      expect(removed).toBe(0);
    });

    it('does not remove body-protected high-density element', () => {
      const linkText = 'y'.repeat(60);
      const root = setHtml(`<div ${PROTECT_ATTR}="true"><a href="#">${linkText}</a></div>`);
      const removed = stripTextDensityElements(root);
      expect(removed).toBe(0);
    });
  });

  describe('stripShortSequenceElements protection', () => {
    it('does not remove body-protected short sequence elements', () => {
      const root = setHtml(`
        <div ${PROTECT_ATTR}="true">
          <p>a</p><p>b</p><p>c</p><p>d</p><p>e</p>
        </div>
      `);
      const removed = stripShortSequenceElements(root);
      expect(removed).toBe(0);
    });
  });

  describe('stripSymbolLineElements branch coverage', () => {
    it('skips empty-text elements', () => {
      const root = setHtml(`<p></p>`);
      const removed = stripSymbolLineElements(root);
      expect(removed).toBe(0);
    });

    it('does not remove body-protected symbol line element', () => {
      const root = setHtml(`<p ${PROTECT_ATTR}="true">|||</p>`);
      const removed = stripSymbolLineElements(root);
      expect(removed).toBe(0);
    });
  });

  describe('stripLinkOnlyParagraphs branch coverage', () => {
    it('skips paragraphs exceeding maxLength', () => {
      const longLink = 'z'.repeat(60);
      const root = setHtml(`<p><a href="#">${longLink}</a></p>`);
      const removed = stripLinkOnlyParagraphs(root);
      expect(removed).toBe(0);
    });

    it('skips paragraph containing non-link non-br child element', () => {
      const root = setHtml(`<p><a href="#">link</a><span>text</span></p>`);
      const removed = stripLinkOnlyParagraphs(root);
      expect(removed).toBe(0);
    });

    it('skips paragraph with a non-link child element that has empty/whitespace text', () => {
      const root = setHtml(`<p><a href="#">link</a><span>   </span></p>`);
      const removed = stripLinkOnlyParagraphs(root);
      expect(removed).toBe(0);
    });

    it('skips paragraph with link + br only (no text) but detects trailing text node', () => {
      const root = setHtml(`<p><a href="#">link</a><br>trailing text</p>`);
      const removed = stripLinkOnlyParagraphs(root);
      expect(removed).toBe(0);
    });

    it('does not remove body-protected link-only paragraph', () => {
      const root = setHtml(`<p ${PROTECT_ATTR}="true"><a href="#">link</a></p>`);
      const removed = stripLinkOnlyParagraphs(root);
      expect(removed).toBe(0);
    });

  });

  describe('stripEnhancedHiddenElements branch coverage', () => {
    it('skips duplicate matches across multiple hidden selectors', () => {
      const root = setHtml(`<div hidden aria-hidden="true" style="display: none;">dup</div>`);
      const removed = stripEnhancedHiddenElements(root);
      expect(removed).toBe(1);
    });

    it('skips opacity:0 element without fixed/sticky positioning', () => {
      const root = setHtml(`<div style="opacity: 0;">not fixed</div>`);
      const removed = stripEnhancedHiddenElements(root);
      expect(removed).toBe(0);
    });

    it('removes opacity:0 element with position:sticky', () => {
      const root = setHtml(`<div style="opacity: 0; position:sticky;">sticky hidden</div>`);
      const removed = stripEnhancedHiddenElements(root);
      expect(removed).toBe(1);
    });

    it('does not remove body-protected hidden element', () => {
      const root = setHtml(`<div hidden ${PROTECT_ATTR}="true">x</div>`);
      const removed = stripEnhancedHiddenElements(root);
      expect(removed).toBe(0);
    });
  });

  describe('stripEmptyElements branch coverage', () => {
    it('skips elements with text content', () => {
      const root = setHtml(`<div>has text</div>`);
      const removed = stripEmptyElements(root);
      expect(removed).toBe(0);
    });

    it('skips elements with images', () => {
      const root = setHtml(`<div><img src="a.png"></div>`);
      const removed = stripEmptyElements(root);
      expect(removed).toBe(0);
    });

    it('skips parent whose child has content (allEmpty=false)', () => {
      const root = setHtml(`<div><span>filled</span></div>`);
      const removed = stripEmptyElements(root);
      expect(removed).toBe(0);
    });


    it('removes parent whose children are all empty', () => {
      const root = setHtml(`<div><span></span><span></span></div>`);
      const removed = stripEmptyElements(root);
      expect(removed).toBeGreaterThan(0);
    });

    it('does not remove body-protected empty element', () => {
      const root = setHtml(`<div ${PROTECT_ATTR}="true"></div>`);
      const removed = stripEmptyElements(root);
      expect(removed).toBe(0);
    });
  });

  describe('stripJPLayoutPatterns dedup + protection', () => {
    it('skips duplicate matches when an element matches multiple JP layout patterns', () => {
      const root = setHtml(`<div class="l-footer common-footer">dup</div>`);
      const removed = stripJPLayoutPatterns(root);
      expect(removed).toBe(1);
    });

    it('does not remove body-protected JP layout element', () => {
      const root = setHtml(`<div class="l-footer" ${PROTECT_ATTR}="true">x</div>`);
      const removed = stripJPLayoutPatterns(root);
      expect(removed).toBe(0);
    });
  });

  describe('stripJPNavigationPatterns dedup + protection', () => {
    it('skips duplicate matches between selector and keyword scan', () => {
      const root = setHtml(`<div class="global-nav">このサイトのメニュー</div>`);
      const removed = stripJPNavigationPatterns(root);
      expect(removed).toBe(1);
    });

    it('does not remove body-protected nav element', () => {
      const root = setHtml(`<div class="global-nav" ${PROTECT_ATTR}="true">x</div>`);
      const removed = stripJPNavigationPatterns(root);
      expect(removed).toBe(0);
    });
  });

  describe('stripAuthorMetaElements dedup + protection', () => {
    it('skips element already counted by selector pass', () => {
      const root = setHtml(`<div class="author-profile">著者: 山田</div>`);
      const removed = stripAuthorMetaElements(root);
      expect(removed).toBe(1);
    });

    it('skips keyword-matching element whose text length exceeds 200 chars', () => {
      const longText = '著者 ' + 'x'.repeat(210);
      const root = setHtml(`<p>${longText}</p>`);
      const removed = stripAuthorMetaElements(root);
      expect(removed).toBe(0);
    });

    it('does not remove body-protected author meta element', () => {
      const root = setHtml(`<div class="author-profile" ${PROTECT_ATTR}="true">x</div>`);
      const removed = stripAuthorMetaElements(root);
      expect(removed).toBe(0);
    });
  });

  describe('stripAffiliateElements branch coverage', () => {
    it('skips nested affiliate element whose ancestor already matched', () => {
      const root = setHtml(`
        <div class="yyi-rinker-box">
          <div class="yyi-rinker-box">nested</div>
        </div>
      `);
      const processed = stripAffiliateElements(root);
      expect(processed).toBe(1);
    });

    it('removes element entirely when no extractable text is found', () => {
      const root = setHtml(`<div class="yyi-rinker-box"></div>`);
      const processed = stripAffiliateElements(root);
      expect(processed).toBe(1);
    });

    it('does not count a body-protected affiliate element with no extractable text (safeRemoveElement returns false)', () => {
      const root = setHtml(`<div class="yyi-rinker-box" ${PROTECT_ATTR}="true"></div>`);
      const processed = stripAffiliateElements(root);
      expect(processed).toBe(0);
    });

    it('replaces with text when title/price text is found', () => {
      const root = setHtml(`
        <div class="yyi-rinker-box">
          <div class="yyi-rinker-title">Product Name</div>
          <div class="price">1000円</div>
        </div>
      `);
      const processed = stripAffiliateElements(root);
      expect(processed).toBe(1);
    });
  });

  describe('stripSpeechBubbles branch coverage', () => {
    it('falls back to full text extraction when no speech-text elements matched', () => {
      const root = setHtml(`<div class="balloon">plain text without markers</div>`);
      const processed = stripSpeechBubbles(root);
      expect(processed).toBe(1);
    });

    it('removes empty balloon entirely when no text at all', () => {
      const root = setHtml(`<div class="balloon"></div>`);
      const processed = stripSpeechBubbles(root);
      expect(processed).toBe(1);
    });

    it('does not count a body-protected empty balloon (safeRemoveElement returns false)', () => {
      const root = setHtml(`<div class="balloon" ${PROTECT_ATTR}="true"></div>`);
      const processed = stripSpeechBubbles(root);
      expect(processed).toBe(0);
    });

    it('does not count a body-protected balloon with fallback text (safeReplaceWithText returns false)', () => {
      const root = setHtml(`<div class="balloon" ${PROTECT_ATTR}="true">plain text without markers</div>`);
      const processed = stripSpeechBubbles(root);
      expect(processed).toBe(0);
    });

    it('does not count a body-protected balloon with matched speech-text (safeReplaceWithText returns false)', () => {
      const root = setHtml(`<div class="balloon" ${PROTECT_ATTR}="true"><span class="balloon-text">hello</span></div>`);
      const processed = stripSpeechBubbles(root);
      expect(processed).toBe(0);
    });

    it('skips speech-text element with only whitespace content', () => {
      const root = setHtml(`
        <div class="balloon">
          <span class="balloon-text">   </span>
          fallback text here
        </div>
      `);
      const processed = stripSpeechBubbles(root);
      expect(processed).toBe(1);
    });
  });

  describe('stripNewsMediaPatterns protection', () => {
    it('does not remove body-protected news media element', () => {
      const root = setHtml(`<div class="disqus" ${PROTECT_ATTR}="true">x</div>`);
      const removed = stripNewsMediaPatterns(root);
      expect(removed).toBe(0);
    });
  });

  describe('stripEcSitePatterns protection', () => {
    it('does not remove body-protected EC site element', () => {
      const root = setHtml(`<div class="review-list" ${PROTECT_ATTR}="true">x</div>`);
      const removed = stripEcSitePatterns(root);
      expect(removed).toBe(0);
    });
  });

  describe('stripQaSitePatterns protection', () => {
    it('does not remove body-protected Q&A site element', () => {
      const root = setHtml(`<div class="best-answer-badge" ${PROTECT_ATTR}="true">x</div>`);
      const removed = stripQaSitePatterns(root);
      expect(removed).toBe(0);
    });
  });

  describe('stripVideoSitePatterns protection', () => {
    it('does not remove body-protected video site element', () => {
      const root = setHtml(`<div class="danmaku" ${PROTECT_ATTR}="true">x</div>`);
      const removed = stripVideoSitePatterns(root);
      expect(removed).toBe(0);
    });
  });
});
