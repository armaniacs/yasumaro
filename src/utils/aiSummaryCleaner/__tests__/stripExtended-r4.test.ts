/**
 * @vitest-environment jsdom
 */
/**
 * stripExtended-r4.test.ts — cover remaining uncovered statements 147-149,193-194,201-202,243-244,317-318,359-360,366,379-385,416-417,689-690
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  stripFixedElements,
  stripRecommendSections,
  stripSnsPromoElements,
  stripPopupElements,
  stripCookieConsentElements,
  stripPlatformNoise,
  stripEmptyElements,
} from '../stripExtended.js';

describe('stripExtended - R4 remaining statements', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });
  afterEach(() => {
    root.remove();
  });

  // 147-149 + 366 : text-based cookie consent via COOKIE_TEXT_PATTERNS
  describe('collectCookieConsentElements via popup & cookieConsent', () => {
    it('removes element with Cookieの管理 text via stripPopupElements', () => {
      root.innerHTML = '<div>Cookieの管理について説明します。 Cookieポリシーを参照してください。</div><p>content</p>';
      const count = stripPopupElements(root);
      expect(count).toBeGreaterThanOrEqual(1);
    });
    it('removes element with Always active text', () => {
      root.innerHTML = '<p>Always active Marketing Cookies consent</p>';
      const count = stripPopupElements(root);
      expect(count).toBe(1);
    });
    it('removes via stripCookieConsentElements directly', () => {
      root.innerHTML = '<div>Marketing Cookies and Cookie consent text here</div>';
      const count = stripCookieConsentElements(root);
      expect(count).toBe(1);
    });
    it('skips too short text (<10 chars) and too long (>1200)', () => {
      root.innerHTML = '<div>Cookie</div><div>' + 'a'.repeat(1201) + ' Cookieの管理</div>';
      const count = stripCookieConsentElements(root);
      expect(count).toBe(0);
    });
    it('skips elements with >=3 nested p/article/section', () => {
      root.innerHTML = '<div>Cookieの管理 <p>a</p><p>b</p><p>c</p></div>';
      const count = stripCookieConsentElements(root);
      expect(count).toBe(0);
    });
    it('skips already counted elements (dedup)', () => {
      root.innerHTML = '<div class="cookie-banner">Cookieの管理</div>';
      // cookie-banner already matched via POPUP_SELECTOR, then collectCookie should skip counted
      const count = stripPopupElements(root);
      expect(count).toBe(1);
      // Should not double-count
    });
  });

  // 193-194 yahoo fixed
  describe('stripFixedElements yahoo', () => {
    it('removes yahoo-news with fixed', () => {
      root.innerHTML = '<div class="yahoo-news-top" style="position: fixed;">header</div>';
      expect(stripFixedElements(root)).toBe(1);
    });
    it('removes headerWrap with sticky', () => {
      root.innerHTML = '<div id="headerWrap" style="position: sticky;">h</div>';
      expect(stripFixedElements(root)).toBe(1);
    });
    it('removes Topics with fixed', () => {
      root.innerHTML = '<div class="Topics" style="position: fixed;">t</div>';
      expect(stripFixedElements(root)).toBe(1);
    });
    it('removes IssueTop with fixed', () => {
      root.innerHTML = '<div class="IssueTop" style="position:fixed;">i</div>';
      expect(stripFixedElements(root)).toBe(1);
    });
  });

  // 201-202 game8 fixed
  describe('stripFixedElements game8', () => {
    it('removes game8 with fixed', () => {
      root.innerHTML = '<div class="game8-header" style="position: fixed;">g</div>';
      expect(stripFixedElements(root)).toBe(1);
    });
    it('removes headerMenu with fixed', () => {
      root.innerHTML = '<div class="headerMenu" style="position: fixed;">m</div>';
      expect(stripFixedElements(root)).toBe(1);
    });
    it('removes SideBar with sticky', () => {
      root.innerHTML = '<div class="SideBar" style="position: sticky;">s</div>';
      expect(stripFixedElements(root)).toBe(1);
    });
    it('removes id SideBar', () => {
      root.innerHTML = '<div id="SideBar" style="position: fixed;">s</div>';
      expect(stripFixedElements(root)).toBe(1);
    });
  });

  // 243-244 recommend game8 ranking
  describe('stripRecommendSections game8 ranking', () => {
    it('removes rankingList', () => {
      root.innerHTML = '<div class="rankingList">r</div>';
      expect(stripRecommendSections(root)).toBe(1);
    });
    it('removes RankingBox', () => {
      root.innerHTML = '<div class="RankingBox">r</div>';
      expect(stripRecommendSections(root)).toBe(1);
    });
    it('removes id Ranking', () => {
      root.innerHTML = '<div id="Ranking">r</div>';
      expect(stripRecommendSections(root)).toBe(1);
    });
  });

  // 317-318 AdHolder isLikelyAd
  describe('stripSnsPromoElements AdHolder isLikelyAd true', () => {
    it('removes AdHolder with sponsored text', () => {
      root.innerHTML = '<div class="AdHolder">sponsored content</div>';
      expect(stripSnsPromoElements(root)).toBe(1);
    });
    it('removes ad id with advertise text', () => {
      root.innerHTML = '<div id="ad-123">advertise here</div>';
      expect(stripSnsPromoElements(root)).toBe(1);
    });
    it('removes data-a-divination with ad class', () => {
      root.innerHTML = '<div data-a-divination class="ad-banner">promoted</div>';
      expect(stripSnsPromoElements(root)).toBe(1);
    });
  });

  // 359-360 cookie isLikelyPopup
  describe('stripPopupElements cookie isLikelyPopup true', () => {
    it('removes cookie with popup class', () => {
      root.innerHTML = '<div id="cookieConsent" class="popup-cookie">Cookie consent</div>';
      expect(stripPopupElements(root)).toBe(1);
    });
    it('removes consent with modal', () => {
      root.innerHTML = '<div class="consent-modal">consent</div>';
      expect(stripPopupElements(root)).toBe(1);
    });
    it('removes cookie with fixed short class (isLikelyPopup via style)', () => {
      root.innerHTML = '<div id="consentBox" class="ab" style="position: fixed;">consent</div>';
      expect(stripPopupElements(root)).toBe(1);
    });
  });

  // 379-385 stripCookieConsentElements counting
  describe('stripCookieConsentElements full flow', () => {
    it('removes and counts', () => {
      root.innerHTML = '<div>Manage cookie preferences please</div>';
      expect(stripCookieConsentElements(root)).toBe(1);
      expect(root.querySelector('div')).toBeNull();
    });
    it('respects body protection (safeRemove false)', () => {
      root.innerHTML = '<div data-ow-body-protected="true"><div>Manage cookie preferences</div></div>';
      expect(stripCookieConsentElements(root)).toBe(0);
    });
  });

  // 416-417 platform noise isPlatformNoise
  describe('stripPlatformNoise isPlatformNoise true', () => {
    it('removes youtube-comment class', () => {
      root.innerHTML = '<div class="youtube-comment">c</div>';
      expect(stripPlatformNoise(root)).toBe(1);
    });
    it('removes number class with comment id', () => {
      root.innerHTML = '<div class="number" id="comment-123">c</div>';
      expect(stripPlatformNoise(root)).toBe(1);
    });
    it('removes postnum with related id', () => {
      root.innerHTML = '<div class="postnum" id="related">r</div>';
      expect(stripPlatformNoise(root)).toBe(1);
    });
    it('removes beid with ad word', () => {
      root.innerHTML = '<div class="beid ad">ad</div>';
      expect(stripPlatformNoise(root)).toBe(1);
    });
  });

  // 689-690 empty allEmpty
  describe('stripEmptyElements allEmpty true', () => {
    it('removes parent with all empty children (allEmpty push)', () => {
      root.innerHTML = '<div><span></span><p></p></div>';
      const count = stripEmptyElements(root);
      // div should be removed (689-690), plus children
      expect(count).toBeGreaterThanOrEqual(1);
      expect(root.querySelector('div')).toBeNull();
    });
    it('removes section with empty children despite whitespace', () => {
      root.innerHTML = '<section><div>   </div><span> </span></section>';
      const count = stripEmptyElements(root);
      expect(count).toBeGreaterThanOrEqual(1);
    });
    it('does not remove when child has content (allEmpty false)', () => {
      root.innerHTML = '<div><span>hi</span></div>';
      expect(stripEmptyElements(root)).toBe(0);
    });
  });
});
