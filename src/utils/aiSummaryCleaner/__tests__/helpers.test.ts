/**
 * @vitest-environment jsdom
 */

/**
 * helpers.test.ts
 * Unit tests for aiSummaryCleaner/helpers.ts
 */

import {
  buildClassIdSelectors,
  isFixedOrSticky,
  isLikelyAd,
  isLikelyPopup,
  isPlatformNoise,
} from '../helpers.js';

describe('aiSummaryCleaner/helpers', () => {
  describe('buildClassIdSelectors', () => {
    it('builds selectors from patterns', () => {
      const patterns = ['ad', 'banner', 'popup'];
      const selectors = buildClassIdSelectors(patterns);
      expect(selectors).toContain('[class*="ad"]');
      expect(selectors).toContain('[id*="ad"]');
      expect(selectors).toContain('[class*="banner"]');
      expect(selectors).toContain('[id*="banner"]');
      expect(selectors).toContain('[class*="popup"]');
      expect(selectors).toContain('[id*="popup"]');
    });

    it('joins selectors with comma', () => {
      const patterns = ['a', 'b'];
      const selectors = buildClassIdSelectors(patterns);
      expect(selectors).toBe('[class*="a"], [id*="a"], [class*="b"], [id*="b"]');
    });

    it('lowercases patterns', () => {
      const patterns = ['AD', 'Banner'];
      const selectors = buildClassIdSelectors(patterns);
      expect(selectors).toContain('[class*="ad"]');
      expect(selectors).toContain('[class*="banner"]');
    });

    it('returns empty string for empty array', () => {
      expect(buildClassIdSelectors([])).toBe('');
    });

    it('escapes CSS special characters', () => {
      const patterns = ['a[b]', 'c.d'];
      const selectors = buildClassIdSelectors(patterns);
      expect(selectors).toContain('[class*="a\\[b\\]"]');
    });
  });

  describe('isFixedOrSticky', () => {
    it('detects position: fixed in style attribute', () => {
      const el = document.createElement('div');
      el.setAttribute('style', 'position: fixed; top: 0;');
      expect(isFixedOrSticky(el)).toBe(true);
    });

    it('detects position:fixed without space', () => {
      const el = document.createElement('div');
      el.setAttribute('style', 'position:fixed;top:0;');
      expect(isFixedOrSticky(el)).toBe(true);
    });

    it('detects position: sticky', () => {
      const el = document.createElement('div');
      el.setAttribute('style', 'position: sticky; bottom: 0;');
      expect(isFixedOrSticky(el)).toBe(true);
    });

    it('detects position:sticky without space', () => {
      const el = document.createElement('div');
      el.setAttribute('style', 'position:sticky;bottom:0;');
      expect(isFixedOrSticky(el)).toBe(true);
    });

    it('returns false for static positioning', () => {
      const el = document.createElement('div');
      el.setAttribute('style', 'position: static;');
      expect(isFixedOrSticky(el)).toBe(false);
    });

    it('returns false when no style attribute', () => {
      const el = document.createElement('div');
      expect(isFixedOrSticky(el)).toBe(false);
    });

    it('returns false for relative positioning', () => {
      const el = document.createElement('div');
      el.setAttribute('style', 'position: relative;');
      expect(isFixedOrSticky(el)).toBe(false);
    });
  });

  describe('isLikelyAd', () => {
    it('detects ad in class name', () => {
      const el = document.createElement('div');
      el.className = 'ad-container';
      expect(isLikelyAd(el)).toBe(true);
    });

    it('detects standalone ad in class name', () => {
      const el = document.createElement('div');
      el.className = 'ad';
      expect(isLikelyAd(el)).toBe(true);
    });

    it('detects ad separated by hyphen', () => {
      const el = document.createElement('div');
      el.className = 'my-ad-banner';
      expect(isLikelyAd(el)).toBe(true);
    });

    it('detects ad separated by underscore', () => {
      const el = document.createElement('div');
      el.className = 'my_ad_banner';
      expect(isLikelyAd(el)).toBe(true);
    });

    it('detects ad with hyphen separator', () => {
      const el = document.createElement('div');
      el.className = 'top-ad-banner';
      expect(isLikelyAd(el)).toBe(true);
    });

    it('does not detect ad inside other words', () => {
      const el = document.createElement('div');
      el.className = 'header loaded';
      expect(isLikelyAd(el)).toBe(false);
    });

    it('detects ad in ID', () => {
      const el = document.createElement('div');
      el.id = 'sidebar-ad';
      expect(isLikelyAd(el)).toBe(true);
    });

    it('detects sponsored in text content', () => {
      const el = document.createElement('div');
      el.textContent = 'This is sponsored content';
      expect(isLikelyAd(el)).toBe(true);
    });

    it('detects promoted in text content', () => {
      const el = document.createElement('div');
      el.textContent = 'Promoted post';
      expect(isLikelyAd(el)).toBe(true);
    });

    it('returns false for non-ad content', () => {
      const el = document.createElement('div');
      el.className = 'content';
      el.textContent = 'Normal article text';
      expect(isLikelyAd(el)).toBe(false);
    });

    it('detects advertise in text content', () => {
      const el = document.createElement('div');
      el.textContent = 'advertise with us';
      expect(isLikelyAd(el)).toBe(true);
    });
  });

  describe('isLikelyPopup', () => {
    it('detects popup in class name', () => {
      const el = document.createElement('div');
      el.className = 'popup-overlay';
      expect(isLikelyPopup(el)).toBe(true);
    });

    it('detects modal in class name', () => {
      const el = document.createElement('div');
      el.className = 'modal-dialog';
      expect(isLikelyPopup(el)).toBe(true);
    });

    it('detects overlay in class name', () => {
      const el = document.createElement('div');
      el.className = 'dark-overlay';
      expect(isLikelyPopup(el)).toBe(true);
    });

    it('detects cookie in class name', () => {
      const el = document.createElement('div');
      el.className = 'cookie-banner';
      expect(isLikelyPopup(el)).toBe(true);
    });

    it('detects consent in class name', () => {
      const el = document.createElement('div');
      el.className = 'consent-dialog';
      expect(isLikelyPopup(el)).toBe(true);
    });

    it('detects banner in class name', () => {
      const el = document.createElement('div');
      el.className = 'top-banner';
      expect(isLikelyPopup(el)).toBe(true);
    });

    it('detects popup in ID', () => {
      const el = document.createElement('div');
      el.id = 'newsletter-popup';
      expect(isLikelyPopup(el)).toBe(true);
    });

    it('detects modal in ID', () => {
      const el = document.createElement('div');
      el.id = 'login-modal';
      expect(isLikelyPopup(el)).toBe(true);
    });

    it('detects fixed position with short class name', () => {
      const el = document.createElement('div');
      el.setAttribute('style', 'position: fixed;');
      el.className = 'popup';
      expect(isLikelyPopup(el)).toBe(true);
    });

    it('returns false for fixed position with long class name', () => {
      const el = document.createElement('div');
      el.setAttribute('style', 'position: fixed;');
      el.className = 'a'.repeat(60);
      expect(isLikelyPopup(el)).toBe(false);
    });

    it('returns false for normal content', () => {
      const el = document.createElement('div');
      el.className = 'article-content';
      expect(isLikelyPopup(el)).toBe(false);
    });
  });

  describe('isPlatformNoise', () => {
    it('detects ad in class name', () => {
      const el = document.createElement('div');
      el.className = 'ad-banner';
      expect(isPlatformNoise(el)).toBe(true);
    });

    it('detects ad in ID', () => {
      const el = document.createElement('div');
      el.id = 'video-ad';
      expect(isPlatformNoise(el)).toBe(true);
    });

    it('detects youtube comment pattern', () => {
      const el = document.createElement('div');
      el.className = 'comment youtube';
      expect(isPlatformNoise(el)).toBe(true);
    });

    it('detects comment in ID', () => {
      const el = document.createElement('div');
      el.id = 'comments';
      expect(isPlatformNoise(el)).toBe(true);
    });

    it('detects related in ID', () => {
      const el = document.createElement('div');
      el.id = 'related-videos';
      expect(isPlatformNoise(el)).toBe(true);
    });

    it('returns false for normal content', () => {
      const el = document.createElement('div');
      el.className = 'article-body';
      el.id = 'main-content';
      expect(isPlatformNoise(el)).toBe(false);
    });

    it('does not match ad inside other words', () => {
      const el = document.createElement('div');
      el.className = 'header loaded';
      expect(isPlatformNoise(el)).toBe(false);
    });
  });
});
