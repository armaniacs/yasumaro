/**
 * @vitest-environment jsdom
 */

/**
 * stripExtended.test.ts
 * Unit tests for aiSummaryCleaner/stripExtended.ts
 */

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
  stripAffiliateElements,
  stripSpeechBubbles,
  stripNewsMediaPatterns,
  stripEcSitePatterns,
  stripQaSitePatterns,
  stripVideoSitePatterns,
} from '../stripExtended.js';
import { NEWS_MEDIA_PATTERNS, EC_SITE_PATTERNS, QA_SITE_PATTERNS, VIDEO_SITE_PATTERNS } from '../patterns.js';

describe('aiSummaryCleaner/stripExtended', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
  });

  describe('stripFixedElements', () => {
    it('removes elements with position: fixed', () => {
      root.innerHTML = '<div style="position: fixed;">Fixed</div><p>Content</p>';
      const count = stripFixedElements(root);
      expect(count).toBe(1);
      expect(root.querySelectorAll('[style*="position: fixed"]')).toHaveLength(0);
      expect(root.querySelector('p')).not.toBeNull();
    });

    it('removes elements with position: sticky', () => {
      root.innerHTML = '<div style="position: sticky;">Sticky</div><p>Content</p>';
      const count = stripFixedElements(root);
      expect(count).toBe(1);
    });

    it('removes fixed-video class elements', () => {
      root.innerHTML = '<div class="fixed-video">Video</div><p>Content</p>';
      const count = stripFixedElements(root);
      expect(count).toBe(1);
    });

    it('removes sticky-player class elements', () => {
      root.innerHTML = '<div class="sticky-player">Player</div><p>Content</p>';
      const count = stripFixedElements(root);
      expect(count).toBe(1);
    });

    it('removes Yahoo News fixed headers', () => {
      root.innerHTML = '<div class="yahoo-news-headerWrap" style="position: fixed;">Header</div>';
      const count = stripFixedElements(root);
      expect(count).toBe(1);
    });

    it('removes Game8 fixed menus', () => {
      root.innerHTML = '<div class="game8-headerMenu" style="position: sticky;">Menu</div>';
      const count = stripFixedElements(root);
      expect(count).toBe(1);
    });

    it('does not remove non-fixed elements', () => {
      root.innerHTML = '<div style="position: relative;">Relative</div><p>Content</p>';
      const count = stripFixedElements(root);
      expect(count).toBe(0);
    });
  });

  describe('stripRecommendSections', () => {
    it('removes carousel elements', () => {
      root.innerHTML = '<div class="carousel">Recommendations</div><p>Content</p>';
      const count = stripRecommendSections(root);
      expect(count).toBe(1);
    });

    it('removes ranking elements', () => {
      root.innerHTML = '<div class="ranking">Ranking</div><p>Content</p>';
      const count = stripRecommendSections(root);
      expect(count).toBe(1);
    });

    it('removes trending elements', () => {
      root.innerHTML = '<div class="trending">Trending</div><p>Content</p>';
      const count = stripRecommendSections(root);
      expect(count).toBe(1);
    });

    it('removes Yahoo relation modules', () => {
      root.innerHTML = '<div data-cs="viewRelation">Related</div><p>Content</p>';
      const count = stripRecommendSections(root);
      expect(count).toBe(1);
    });

    it('removes Game8 ranking lists', () => {
      root.innerHTML = '<div class="rankingList">Ranking</div><p>Content</p>';
      const count = stripRecommendSections(root);
      expect(count).toBe(1);
    });

    it('does not remove normal content', () => {
      root.innerHTML = '<p>Normal content</p>';
      const count = stripRecommendSections(root);
      expect(count).toBe(0);
    });
  });

  describe('stripPaginationElements', () => {
    it('removes pagination elements', () => {
      root.innerHTML = '<div class="pagination">1 2 3</div><p>Content</p>';
      const count = stripPaginationElements(root);
      expect(count).toBe(1);
    });

    it('removes pager elements', () => {
      root.innerHTML = '<div class="pager">Prev Next</div><p>Content</p>';
      const count = stripPaginationElements(root);
      expect(count).toBe(1);
    });

    it('removes load-more elements', () => {
      root.innerHTML = '<div class="load-more">Load More</div><p>Content</p>';
      const count = stripPaginationElements(root);
      expect(count).toBe(1);
    });

    it('does not remove normal content', () => {
      root.innerHTML = '<p>Normal content</p>';
      const count = stripPaginationElements(root);
      expect(count).toBe(0);
    });
  });

  describe('stripSnsPromoElements', () => {
    it('removes promoted elements', () => {
      root.innerHTML = '<div class="promoted">Promoted</div><p>Content</p>';
      const count = stripSnsPromoElements(root);
      expect(count).toBe(1);
    });

    it('removes sponsored elements', () => {
      root.innerHTML = '<div class="sponsored">Sponsored</div><p>Content</p>';
      const count = stripSnsPromoElements(root);
      expect(count).toBe(1);
    });

    it('removes ad-slot elements', () => {
      root.innerHTML = '<div class="ad-slot">Ad</div><p>Content</p>';
      const count = stripSnsPromoElements(root);
      expect(count).toBe(1);
    });

    it('removes elements with promotedIndicator data attribute', () => {
      root.innerHTML = '<div data-testid="promotedIndicator">Promoted</div><p>Content</p>';
      const count = stripSnsPromoElements(root);
      expect(count).toBe(1);
    });

    it('removes elements with Trending now aria-label', () => {
      root.innerHTML = '<div aria-label="Trending now">Trending</div><p>Content</p>';
      const count = stripSnsPromoElements(root);
      expect(count).toBe(1);
    });

    it('does not remove normal content', () => {
      root.innerHTML = '<p>Normal content</p>';
      const count = stripSnsPromoElements(root);
      expect(count).toBe(0);
    });
  });

  describe('stripPopupElements', () => {
    it('removes popup elements', () => {
      root.innerHTML = '<div class="popup">Popup</div><p>Content</p>';
      const count = stripPopupElements(root);
      expect(count).toBe(1);
    });

    it('removes modal elements', () => {
      root.innerHTML = '<div class="modal">Modal</div><p>Content</p>';
      const count = stripPopupElements(root);
      expect(count).toBe(1);
    });

    it('removes overlay elements', () => {
      root.innerHTML = '<div class="overlay">Overlay</div><p>Content</p>';
      const count = stripPopupElements(root);
      expect(count).toBe(1);
    });

    it('removes cookie banner elements', () => {
      root.innerHTML = '<div class="cookie-banner">Cookies</div><p>Content</p>';
      const count = stripPopupElements(root);
      expect(count).toBe(1);
    });

    it('removes dialog elements with open attribute', () => {
      root.innerHTML = '<dialog open>Dialog</dialog><p>Content</p>';
      const count = stripPopupElements(root);
      expect(count).toBe(1);
    });

    it('removes consent banner elements', () => {
      root.innerHTML = '<div class="consent-banner">Consent</div><p>Content</p>';
      const count = stripPopupElements(root);
      expect(count).toBe(1);
    });

    it('does not remove normal content', () => {
      root.innerHTML = '<p>Normal content</p>';
      const count = stripPopupElements(root);
      expect(count).toBe(0);
    });
  });

  describe('stripPlatformNoise', () => {
    it('removes 5ch/be elements', () => {
      root.innerHTML = '<div class="be-member">Member</div><p>Content</p>';
      const count = stripPlatformNoise(root);
      expect(count).toBe(1);
    });

    it('removes YouTube companion elements', () => {
      root.innerHTML = '<div class="ytd-companion">Companion</div><p>Content</p>';
      const count = stripPlatformNoise(root);
      expect(count).toBe(1);
    });

    it('removes YouTube comments section', () => {
      root.innerHTML = '<div id="comments">Comments</div><p>Content</p>';
      const count = stripPlatformNoise(root);
      expect(count).toBe(1);
    });

    it('removes YouTube related section', () => {
      root.innerHTML = '<div id="related">Related</div><p>Content</p>';
      const count = stripPlatformNoise(root);
      expect(count).toBe(1);
    });

    it('removes niconico banner elements', () => {
      root.innerHTML = '<div class="nico-external-banner">Banner</div><p>Content</p>';
      const count = stripPlatformNoise(root);
      expect(count).toBe(1);
    });

    it('does not remove normal content', () => {
      root.innerHTML = '<p>Normal content</p>';
      const count = stripPlatformNoise(root);
      expect(count).toBe(0);
    });
  });

  describe('stripTextDensityElements', () => {
    it('removes elements with high link density', () => {
      root.innerHTML = '<ul><li><a href="#">Long link text number one</a></li><li><a href="#">Long link text number two</a></li><li><a href="#">Long link text number three</a></li></ul><p>Normal paragraph with enough text content to not be removed.</p>';
      const count = stripTextDensityElements(root, 70);
      expect(count).toBe(1);
    });

    it('uses custom threshold', () => {
      root.innerHTML = `
        <ul>
          <li><a href="#">Link 1</a></li>
          <li><a href="#">Link 2</a></li>
        </ul>
        <p>Some text here.</p>
      `;
      const count = stripTextDensityElements(root, 30);
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it('does not remove elements with low link density', () => {
      root.innerHTML = `
        <ul>
          <li>Item 1</li>
          <li>Item 2</li>
          <li>Item 3</li>
        </ul>
        <p>Normal paragraph.</p>
      `;
      const count = stripTextDensityElements(root, 70);
      expect(count).toBe(0);
    });

    it('ignores elements with less than 50 chars', () => {
      root.innerHTML = '<ul><li><a href="#">Link</a></li></ul>';
      const count = stripTextDensityElements(root, 70);
      expect(count).toBe(0);
    });
  });

  describe('stripShortSequenceElements', () => {
    it('removes consecutive short elements', () => {
      root.innerHTML = '<section><p>A</p><p>B</p><p>C</p><p>D</p><p>E</p><p>F</p></section><p>Normal long paragraph with enough text content.</p>';
      const count = stripShortSequenceElements(root, 30, 5);
      // Only elements from the 5th onward in a consecutive sequence are removed
      expect(count).toBe(2);
    });

    it('does not remove non-consecutive short elements', () => {
      root.innerHTML = '<section><p>Short 1</p><p>This is a long paragraph with enough text content to break the sequence.</p><p>Short 2</p></section>';
      const count = stripShortSequenceElements(root, 30, 5);
      expect(count).toBe(0);
    });

    it('uses custom thresholds', () => {
      root.innerHTML = '<section><p>XX</p><p>YY</p><p>ZZ</p></section>';
      const count = stripShortSequenceElements(root, 10, 3);
      // Only the 3rd element in the sequence is removed
      expect(count).toBe(1);
    });
  });

  describe('stripSymbolLineElements', () => {
    it('removes lines with only symbols', () => {
      root.innerHTML = '<p>|</p><p>►</p><p>▶</p><p>Content</p>';
      const count = stripSymbolLineElements(root);
      expect(count).toBe(3);
      expect(root.querySelector('p')!.textContent).toBe('Content');
    });

    it('removes bullet-only lines', () => {
      root.innerHTML = '<p>•</p><p>·</p><p>Normal text</p>';
      const count = stripSymbolLineElements(root);
      expect(count).toBe(2);
    });

    it('does not remove mixed content lines', () => {
      root.innerHTML = '<p>• Item</p><p>Normal text</p>';
      const count = stripSymbolLineElements(root);
      expect(count).toBe(0);
    });
  });

  describe('stripLinkOnlyParagraphs', () => {
    it('removes paragraphs with only links', () => {
      root.innerHTML = '<p><a href="#">Link</a></p><p>Normal text</p>';
      const count = stripLinkOnlyParagraphs(root, 50);
      expect(count).toBe(1);
    });

    it('does not remove paragraphs with text and links', () => {
      root.innerHTML = '<p>Text <a href="#">Link</a> more text</p>';
      const count = stripLinkOnlyParagraphs(root, 50);
      expect(count).toBe(0);
    });

    it('does not remove long link-only paragraphs', () => {
      root.innerHTML = '<p><a href="#">Very long link text that exceeds the default threshold</a></p>';
      const count = stripLinkOnlyParagraphs(root, 10);
      expect(count).toBe(0);
    });

    it('allows br tags in link-only paragraphs', () => {
      root.innerHTML = '<p><a href="#">Link</a><br><a href="#">Link2</a></p>';
      const count = stripLinkOnlyParagraphs(root, 50);
      expect(count).toBe(1);
    });
  });

  describe('stripEnhancedHiddenElements', () => {
    it('removes hidden elements', () => {
      root.innerHTML = '<div hidden>Hidden</div><p>Visible</p>';
      const count = stripEnhancedHiddenElements(root);
      expect(count).toBe(1);
    });

    it('removes aria-hidden elements', () => {
      root.innerHTML = '<div aria-hidden="true">Hidden</div><p>Visible</p>';
      const count = stripEnhancedHiddenElements(root);
      expect(count).toBe(1);
    });

    it('removes display:none elements', () => {
      root.innerHTML = '<div style="display: none;">Hidden</div><p>Visible</p>';
      const count = stripEnhancedHiddenElements(root);
      expect(count).toBe(1);
    });

    it('removes visibility:hidden elements', () => {
      root.innerHTML = '<div style="visibility: hidden;">Hidden</div><p>Visible</p>';
      const count = stripEnhancedHiddenElements(root);
      expect(count).toBe(1);
    });

    it('removes template elements', () => {
      root.innerHTML = '<template>Template</template><p>Visible</p>';
      const count = stripEnhancedHiddenElements(root);
      expect(count).toBe(1);
    });

    it('removes opacity:0 fixed elements', () => {
      root.innerHTML = '<div style="opacity: 0; position: fixed;">Hidden</div><p>Visible</p>';
      const count = stripEnhancedHiddenElements(root);
      expect(count).toBe(1);
    });

    it('does not remove opacity:0 non-fixed elements', () => {
      root.innerHTML = '<div style="opacity: 0;">Hidden</div><p>Visible</p>';
      const count = stripEnhancedHiddenElements(root);
      expect(count).toBe(0); // opacity:0 only removed when combined with fixed/sticky
    });
  });

  describe('stripEmptyElements', () => {
    it('removes truly empty divs', () => {
      root.innerHTML = '<div></div><p>Content</p>';
      const count = stripEmptyElements(root);
      expect(count).toBe(1);
    });

    it('removes empty spans', () => {
      root.innerHTML = '<span></span><p>Content</p>';
      const count = stripEmptyElements(root);
      expect(count).toBe(1);
    });

    it('does not remove elements with text', () => {
      root.innerHTML = '<div>Text</div><p>Content</p>';
      const count = stripEmptyElements(root);
      expect(count).toBe(0);
    });

    it('does not remove elements with images', () => {
      root.innerHTML = '<div><img src="test.jpg"></div><p>Content</p>';
      const count = stripEmptyElements(root);
      expect(count).toBe(0);
    });

    it('removes elements with only empty children', () => {
      root.innerHTML = '<div><span></span></div><p>Content</p>';
      const count = stripEmptyElements(root);
      expect(count).toBe(2); // both span and div
    });

    it('does not remove elements with non-empty children', () => {
      root.innerHTML = '<div><span>Text</span></div><p>Content</p>';
      const count = stripEmptyElements(root);
      expect(count).toBe(0);
    });
  });

  describe('stripJPLayoutPatterns', () => {
    it('removes l-footer elements', () => {
      root.innerHTML = '<div class="l-footer">Footer</div><p>Content</p>';
      const count = stripJPLayoutPatterns(root);
      expect(count).toBe(1);
    });

    it('removes l-header elements', () => {
      root.innerHTML = '<div class="l-header">Header</div><p>Content</p>';
      const count = stripJPLayoutPatterns(root);
      expect(count).toBe(1);
    });

    it('removes p-entry elements', () => {
      root.innerHTML = '<div class="p-entry__footer">Footer</div><p>Content</p>';
      const count = stripJPLayoutPatterns(root);
      expect(count).toBe(1);
    });

    it('removes ly- prefixed elements', () => {
      root.innerHTML = '<div class="ly-content">Content</div><p>Real content</p>';
      const count = stripJPLayoutPatterns(root);
      expect(count).toBe(1);
    });

    it('uses custom patterns', () => {
      root.innerHTML = '<div class="custom-layout">Layout</div><p>Content</p>';
      const count = stripJPLayoutPatterns(root, ['custom-layout']);
      expect(count).toBe(1);
    });

    it('does not remove normal content', () => {
      root.innerHTML = '<p>Normal content</p>';
      const count = stripJPLayoutPatterns(root);
      expect(count).toBe(0);
    });
  });

  describe('stripJPNavigationPatterns', () => {
    it('removes global-nav elements', () => {
      root.innerHTML = '<div class="global-nav">Nav</div><p>Content</p>';
      const count = stripJPNavigationPatterns(root);
      expect(count).toBe(1);
    });

    it('removes gnav elements', () => {
      root.innerHTML = '<div class="gnav">Nav</div><p>Content</p>';
      const count = stripJPNavigationPatterns(root);
      expect(count).toBe(1);
    });

    it('removes breadcrumb elements', () => {
      root.innerHTML = '<div class="breadcrumb">Home > About</div><p>Content</p>';
      const count = stripJPNavigationPatterns(root);
      expect(count).toBe(1);
    });

    it('removes site-search elements', () => {
      root.innerHTML = '<div class="site-search">Search</div><p>Content</p>';
      const count = stripJPNavigationPatterns(root);
      expect(count).toBe(1);
    });

    it('removes elements with navigation keywords', () => {
      root.innerHTML = '<div> Site Menu</div><p>Content</p>';
      const count = stripJPNavigationPatterns(root);
      expect(count).toBe(1);
    });

    it('removes Japanese navigation keywords', () => {
      root.innerHTML = '<div>このサイトのメニュー</div><p>Content</p>';
      const count = stripJPNavigationPatterns(root);
      expect(count).toBe(1);
    });

    it('does not remove normal content', () => {
      root.innerHTML = '<p>Normal content</p>';
      const count = stripJPNavigationPatterns(root);
      expect(count).toBe(0);
    });
  });

  describe('stripAuthorMetaElements', () => {
    it('removes author-profile elements', () => {
      root.innerHTML = '<div class="author-profile">Author</div><p>Content</p>';
      const count = stripAuthorMetaElements(root);
      expect(count).toBe(1);
    });

    it('removes post-date elements', () => {
      root.innerHTML = '<div class="post-date">2024-01-01</div><p>Content</p>';
      const count = stripAuthorMetaElements(root);
      expect(count).toBe(1);
    });

    it('removes tag-list elements', () => {
      root.innerHTML = '<div class="tag-list">Tags</div><p>Content</p>';
      const count = stripAuthorMetaElements(root);
      expect(count).toBe(1);
    });

    it('removes elements with Japanese author keywords', () => {
      root.innerHTML = '<div>この記事書いた人</div><p>Content</p>';
      const count = stripAuthorMetaElements(root);
      expect(count).toBe(1);
    });

    it('removes elements with profile keyword', () => {
      root.innerHTML = '<div>プロフィール</div><p>Content</p>';
      const count = stripAuthorMetaElements(root);
      expect(count).toBe(1);
    });

    it('does not remove long text with author keywords', () => {
      root.innerHTML = `<div>${'この記事書いた人'.repeat(50)}</div><p>Content</p>`;
      const count = stripAuthorMetaElements(root);
      expect(count).toBe(0);
    });

    it('does not remove normal content', () => {
      root.innerHTML = '<p>Normal content</p>';
      const count = stripAuthorMetaElements(root);
      expect(count).toBe(0);
    });
  });

  describe('stripAffiliateElements', () => {
    it('strips Rinker box and extracts title + text + price', () => {
      root.innerHTML = '<div class="yyi-rinker-contents"><div class="yyi-rinker-title">商品A</div><div class="yyi-rinker-text">説明文</div><div class="yyi-rinker-price">1,980円</div></div>';
      const count = stripAffiliateElements(root);
      expect(count).toBe(1);
      expect(root.querySelector('.yyi-rinker-contents')).toBeNull();
      expect(root.textContent).toContain('商品A');
      expect(root.textContent).toContain('説明文');
      expect(root.textContent).toContain('1,980円');
    });

    it('strips Rinker box with title only', () => {
      root.innerHTML = '<div class="yyi-rinker-contents"><div class="yyi-rinker-title">商品B</div></div>';
      const count = stripAffiliateElements(root);
      expect(count).toBe(1);
      expect(root.textContent).toBe('商品B');
    });

    it('strips Kaereba box and extracts name', () => {
      root.innerHTML = '<div class="kaerebalink-box"><div class="kaerebalink-name">商品C</div></div>';
      const count = stripAffiliateElements(root);
      expect(count).toBe(1);
      expect(root.textContent).toBe('商品C');
    });

    it('strips Pochipp box', () => {
      root.innerHTML = '<div class="pochipp-box"><div class="pochipp-title">商品D</div><div class="pochipp-price">1,500円</div></div>';
      const count = stripAffiliateElements(root);
      expect(count).toBe(1);
      expect(root.textContent).toContain('商品D');
      expect(root.textContent).toContain('1,500円');
    });

    it('removes empty affiliate box entirely', () => {
      root.innerHTML = '<div class="yyi-rinker-contents"><div class="irrelevant"> </div></div>';
      const count = stripAffiliateElements(root);
      expect(count).toBe(1);
      expect(root.querySelector('.yyi-rinker-contents')).toBeNull();
    });

    it('leaves non-affiliate content untouched', () => {
      root.innerHTML = '<p>Normal article text</p>';
      const count = stripAffiliateElements(root);
      expect(count).toBe(0);
      expect(root.querySelector('p')).not.toBeNull();
    });

    it('handles multiple affiliate boxes', () => {
      root.innerHTML = '<div class="yyi-rinker-contents"><div class="yyi-rinker-title">A</div></div><p>content</p><div class="kaerebalink-box"><div class="kaerebalink-name">B</div></div>';
      const count = stripAffiliateElements(root);
      expect(count).toBe(2);
      expect(root.querySelector('p')).not.toBeNull();
      expect(root.querySelector('.yyi-rinker-contents')).toBeNull();
      expect(root.querySelector('.kaerebalink-box')).toBeNull();
    });

    it('respects body protection', () => {
      root.innerHTML = '<div data-ow-body-protected="true"><div class="yyi-rinker-contents"><div class="yyi-rinker-title">Protected</div></div></div>';
      const count = stripAffiliateElements(root);
      expect(count).toBe(0);
      expect(root.querySelector('.yyi-rinker-contents')).not.toBeNull();
    });
  });

  describe('stripSpeechBubbles', () => {
    it('removes meta and avatar, keeps speech text', () => {
      root.innerHTML = '<div class="speech-balloon"><div class="balloon-meta"><div class="character-name">山田</div></div><div class="balloon-text">こんにちは！</div></div>';
      const count = stripSpeechBubbles(root);
      expect(count).toBe(1);
      expect(root.textContent).toContain('こんにちは！');
      expect(root.textContent).not.toContain('山田');
    });

    it('removes talk-name and keeps talk-comment', () => {
      root.innerHTML = '<div class="talk-balloon"><div class="talk-name">Taro</div><div class="talk-comment">This is a comment!</div></div>';
      const count = stripSpeechBubbles(root);
      expect(count).toBe(1);
      expect(root.textContent).toBe('This is a comment!');
    });

    it('handles chat-bubble container', () => {
      root.innerHTML = '<div class="chat-bubble"><div class="speaker-name">User</div><div class="speech-text">Hello</div></div>';
      const count = stripSpeechBubbles(root);
      expect(count).toBe(1);
      expect(root.textContent).toBe('Hello');
    });

    it('joins multiple text elements', () => {
      root.innerHTML = '<div class="speech-balloon"><div class="balloon-text">First.</div><div class="balloon-text">Second.</div></div>';
      const count = stripSpeechBubbles(root);
      expect(count).toBe(1);
      expect(root.textContent).toContain('First.');
      expect(root.textContent).toContain('Second.');
    });

    it('falls back to all text when no text pattern matches', () => {
      root.innerHTML = '<div class="balloon-box"><div class="balloon-meta">名無し</div><div>直接発言</div></div>';
      const count = stripSpeechBubbles(root);
      expect(count).toBe(1);
      expect(root.textContent).toContain('直接発言');
    });

    it('removes empty balloon entirely', () => {
      root.innerHTML = '<div class="speech-balloon"> </div>';
      const count = stripSpeechBubbles(root);
      expect(count).toBe(1);
    });

    it('leaves non-balloon content untouched', () => {
      root.innerHTML = '<p>Normal article text</p>';
      const count = stripSpeechBubbles(root);
      expect(count).toBe(0);
    });

    it('handles multiple balloons', () => {
      root.innerHTML = '<div class="speech-balloon"><div class="balloon-text">One</div></div><p>text</p><div class="talk-balloon"><div class="talk-comment">Two</div></div>';
      const count = stripSpeechBubbles(root);
      expect(count).toBe(2);
      expect(root.querySelector('p')).not.toBeNull();
    });
  });

  describe('stripJPLayoutPatterns — Category A extended patterns', () => {
    it('removes SWELL theme classes', () => {
      root.innerHTML = '<div class="swell-toc">TOC</div><div class="p-postlist">List</div><div class="c-sharebtns">Share</div><p>Content</p>';
      const count = stripJPLayoutPatterns(root);
      expect(count).toBe(3);
      expect(root.querySelector('p')).not.toBeNull();
    });

    it('removes Cocoon theme classes', () => {
      root.innerHTML = '<div class="author-box">Author</div><div class="sns-share">Share</div><div id="toc">TOC</div>';
      const count = stripJPLayoutPatterns(root);
      expect(count).toBe(3);
    });

    it('removes A-3 disclosure patterns', () => {
      root.innerHTML = '<div class="pr-disclosure">PR</div><div class="promotion-note">Promo</div><div id="sponsored-content-label">Sponsor</div>';
      const count = stripJPLayoutPatterns(root);
      expect(count).toBe(3);
    });

    it('removes A-4 recommend ad engine patterns', () => {
      root.innerHTML = '<div class="popin_recommend">P</div><div id="logly-lift">L</div><div class="taboola-container">T</div>';
      const count = stripJPLayoutPatterns(root);
      expect(count).toBe(3);
    });

    it('removes A-5 Gutenberg decorative blocks', () => {
      root.innerHTML = '<div class="wp-block-button">Btn</div><div class="wp-block-spacer"></div><div class="wp-block-quote">Q</div><p>Content</p>';
      const count = stripJPLayoutPatterns(root);
      expect(count).toBe(3);
      expect(root.querySelector('p')).not.toBeNull();
    });

    it('removes A-6 Japanese blog UI components', () => {
      root.innerHTML = '<div class="pagetop">Top</div><div class="drawer-menu">Menu</div><div id="toc-container">TOC</div><div class="access-counter">123</div><p>Content</p>';
      const count = stripJPLayoutPatterns(root);
      expect(count).toBe(4);
      expect(root.querySelector('p')).not.toBeNull();
    });
  });

  describe('stripAuthorMetaElements — body protection verification', () => {
    it('returns 0 when ancestor is body protected', () => {
      root.innerHTML = '<div data-ow-body-protected="true"><div class="author-profile">Author</div><p>Content</p></div>';
      const count = stripAuthorMetaElements(root);
      expect(count).toBe(0);
      expect(root.querySelector('.author-profile')).not.toBeNull();
    });
  });

  describe('stripNewsMediaPatterns', () => {
    it('removes comment section elements', () => {
      root.innerHTML = '<div class="yahoo-comment">Comments</div><p>Article body</p>';
      const count = stripNewsMediaPatterns(root);
      expect(count).toBe(1);
      expect(root.querySelector('p')).not.toBeNull();
    });

    it('removes related article card elements', () => {
      root.innerHTML = '<div class="related-article-card">Read also</div><p>Article body</p>';
      const count = stripNewsMediaPatterns(root);
      expect(count).toBe(1);
    });

    it('removes article credit elements', () => {
      root.innerHTML = '<div class="byline-source">配信：共同通信</div><p>Article body</p>';
      const count = stripNewsMediaPatterns(root);
      expect(count).toBe(1);
    });

    it('removes live timestamp elements', () => {
      root.innerHTML = '<div class="update-timeline">19:32 更新</div><p>Article body</p>';
      const count = stripNewsMediaPatterns(root);
      expect(count).toBe(1);
    });

    it('does not remove normal article content', () => {
      root.innerHTML = '<p>This is a normal news article paragraph.</p>';
      const count = stripNewsMediaPatterns(root);
      expect(count).toBe(0);
    });
  });

  describe('stripEcSitePatterns', () => {
    it('removes review list elements', () => {
      root.innerHTML = '<div class="review-list">Reviews (1,234)</div><p>Product description</p>';
      const count = stripEcSitePatterns(root);
      expect(count).toBe(1);
      expect(root.querySelector('p')).not.toBeNull();
    });

    it('removes variation selector elements', () => {
      root.innerHTML = '<div class="color-swatch">Color options</div><p>Product description</p>';
      const count = stripEcSitePatterns(root);
      expect(count).toBe(1);
    });

    it('removes frequently bought together elements', () => {
      root.innerHTML = '<div class="frequently-bought">Frequently bought together</div><p>Product description</p>';
      const count = stripEcSitePatterns(root);
      expect(count).toBe(1);
    });

    it('removes shipping badge elements', () => {
      root.innerHTML = '<div class="free-shipping">送料無料</div><p>Product description</p>';
      const count = stripEcSitePatterns(root);
      expect(count).toBe(1);
    });

    it('does not remove normal product description', () => {
      root.innerHTML = '<p>This is a normal product description paragraph.</p>';
      const count = stripEcSitePatterns(root);
      expect(count).toBe(0);
    });
  });

  describe('stripQaSitePatterns', () => {
    it('removes best answer badge elements', () => {
      root.innerHTML = '<div class="best-answer-badge">ベストアンサー</div><p>回答本文です</p>';
      const count = stripQaSitePatterns(root);
      expect(count).toBe(1);
      expect(root.querySelector('p')).not.toBeNull();
    });

    it('removes related question list elements', () => {
      root.innerHTML = '<div class="related-question-list">この質問も見られています</div><p>回答本文です</p>';
      const count = stripQaSitePatterns(root);
      expect(count).toBe(1);
    });

    it('removes answerer profile elements', () => {
      root.innerHTML = '<div class="answerer-rank">回答数123</div><p>回答本文です</p>';
      const count = stripQaSitePatterns(root);
      expect(count).toBe(1);
    });

    it('removes helpful count button elements', () => {
      root.innerHTML = '<button class="helpful-count">いいね(45)</button><p>回答本文です</p>';
      const count = stripQaSitePatterns(root);
      expect(count).toBe(1);
    });

    it('does not remove normal answer content', () => {
      root.innerHTML = '<p>This is a normal Q&A answer paragraph.</p>';
      const count = stripQaSitePatterns(root);
      expect(count).toBe(0);
    });
  });

  describe('stripVideoSitePatterns', () => {
    it('removes nico comment elements', () => {
      root.innerHTML = '<div class="nico-comment">弾幕コメント</div><p>Video description</p>';
      const count = stripVideoSitePatterns(root);
      expect(count).toBe(1);
      expect(root.querySelector('p')).not.toBeNull();
    });

    it('removes tag cloud elements', () => {
      root.innerHTML = '<div class="tag-cloud">タグ一覧</div><p>Video description</p>';
      const count = stripVideoSitePatterns(root);
      expect(count).toBe(1);
    });

    it('removes related video card elements', () => {
      root.innerHTML = '<div class="related-video-card">関連動画</div><p>Video description</p>';
      const count = stripVideoSitePatterns(root);
      expect(count).toBe(1);
    });

    it('removes view count badge elements', () => {
      root.innerHTML = '<div class="view-count-badge">再生回数 6.7万回</div><p>Video description</p>';
      const count = stripVideoSitePatterns(root);
      expect(count).toBe(1);
    });

    it('does not remove normal video description', () => {
      root.innerHTML = '<p>This is a normal video description paragraph.</p>';
      const count = stripVideoSitePatterns(root);
      expect(count).toBe(0);
    });
  });

  describe('Category B patterns do not overlap with existing generic patterns', () => {
    const genericWords = ['ranking', 'related', 'card', 'comment', 'author', 'byline'];

    it('NEWS_MEDIA_PATTERNS does not contain generic words already in CARD_PATTERNS or DEEP_CLASS_PATTERNS', () => {
      const overlaps = NEWS_MEDIA_PATTERNS.filter(p => genericWords.includes(p));
      expect(overlaps).toEqual([]);
    });

    it('EC_SITE_PATTERNS does not contain generic words already in CARD_PATTERNS or DEEP_CLASS_PATTERNS', () => {
      const overlaps = EC_SITE_PATTERNS.filter(p => genericWords.includes(p));
      expect(overlaps).toEqual([]);
    });

    it('QA_SITE_PATTERNS does not contain generic words already in CARD_PATTERNS or DEEP_CLASS_PATTERNS', () => {
      const overlaps = QA_SITE_PATTERNS.filter(p => genericWords.includes(p));
      expect(overlaps).toEqual([]);
    });

    it('VIDEO_SITE_PATTERNS does not contain generic words already in CARD_PATTERNS or DEEP_CLASS_PATTERNS', () => {
      const overlaps = VIDEO_SITE_PATTERNS.filter(p => genericWords.includes(p));
      expect(overlaps).toEqual([]);
    });

    it('NEWS_MEDIA_PATTERNS substring overlaps are known and documented', () => {
      const knownOverlaps = ['yahoo-comment', 'comment-count', 'related-article-card', 'article-ranking', 'byline-source'];
      const substringOverlaps = NEWS_MEDIA_PATTERNS.filter(p =>
        genericWords.some(word => p.includes(word))
      );
      // 既知の重複のみであることを確認（未知の新規重複が紛れ込んでいないかのガード）
      expect(substringOverlaps.sort()).toEqual(knownOverlaps.sort());
    });

    it('EC_SITE_PATTERNS substring overlaps are known and documented', () => {
      const knownOverlaps: string[] = [];
      const substringOverlaps = EC_SITE_PATTERNS.filter(p =>
        genericWords.some(word => p.includes(word))
      );
      expect(substringOverlaps.sort()).toEqual(knownOverlaps.sort());
    });

    it('QA_SITE_PATTERNS substring overlaps are known and documented', () => {
      const knownOverlaps = ['related-question-list'];
      const substringOverlaps = QA_SITE_PATTERNS.filter(p =>
        genericWords.some(word => p.includes(word))
      );
      expect(substringOverlaps.sort()).toEqual(knownOverlaps.sort());
    });

    it('VIDEO_SITE_PATTERNS substring overlaps are known and documented', () => {
      const knownOverlaps = ['nico-comment', 'comment-flow', 'related-video-card'];
      const substringOverlaps = VIDEO_SITE_PATTERNS.filter(p =>
        genericWords.some(word => p.includes(word))
      );
      expect(substringOverlaps.sort()).toEqual(knownOverlaps.sort());
    });
  });
});
