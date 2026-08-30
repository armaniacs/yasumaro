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
  isLikelySocial,
  isPlatformNoise,
  safeReplaceWithText,
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

  describe('SVG elements', () => {
    const SVG_NS = 'http://www.w3.org/2000/svg';

    it('does not throw for SVG elements whose className is an SVGAnimatedString', () => {
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', 'ad-banner');
      expect(() => isLikelyAd(svg)).not.toThrow();
      expect(() => isLikelyPopup(svg)).not.toThrow();
      expect(() => isPlatformNoise(svg)).not.toThrow();
    });

    it('matches SVG class names the same way as HTML class names', () => {
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', 'ad-banner');
      expect(isLikelyAd(svg)).toBe(true);

      const overlay = document.createElementNS(SVG_NS, 'svg');
      overlay.setAttribute('class', 'overlay');
      expect(isLikelyPopup(overlay)).toBe(true);
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

  describe('safeReplaceWithText', () => {
    it('replaces element with text node and returns true', () => {
      const parent = document.createElement('div');
      parent.innerHTML = '<span id="target">Old text</span>';
      const el = parent.querySelector('#target')!;
      const result = safeReplaceWithText(el, 'New text');
      expect(result).toBe(true);
      expect(parent.querySelector('#target')).toBeNull();
      expect(parent.textContent).toBe('New text');
    });

    it('returns false when element is body protected (direct)', () => {
      const el = document.createElement('div');
      el.setAttribute('data-ow-body-protected', 'true');
      el.innerHTML = '<span id="child">Text</span>';
      const child = el.querySelector('#child')!;
      const result = safeReplaceWithText(child, 'Replaced');
      expect(result).toBe(false);
      expect(el.querySelector('#child')).not.toBeNull();
    });

    it('returns false when ancestor is body protected', () => {
      const ancestor = document.createElement('div');
      ancestor.setAttribute('data-ow-body-protected', 'true');
      ancestor.innerHTML = '<span id="child">Content</span>';
      const child = ancestor.querySelector('#child')!;
      const result = safeReplaceWithText(child, 'Replaced');
      expect(result).toBe(false);
      expect(ancestor.querySelector('#child')).not.toBeNull();
    });

    it('handles empty string text', () => {
      const parent = document.createElement('div');
      parent.innerHTML = '<span id="target">Old</span>';
      const el = parent.querySelector('#target')!;
      const result = safeReplaceWithText(el, '');
      expect(result).toBe(true);
      expect(parent.querySelector('#target')).toBeNull();
      expect(parent.textContent).toBe('');
    });

    it('preserves sibling elements when replacing', () => {
      const parent = document.createElement('div');
      parent.innerHTML = 'before<span id="target">x</span>after';
      const el = parent.querySelector('#target')!;
      const result = safeReplaceWithText(el, 'MID');
      expect(result).toBe(true);
      expect(parent.innerHTML).toBe('beforeMIDafter');
    });

    it('returns true for non-protected element', () => {
      const el = document.createElement('div');
      el.textContent = 'Plain text';
      const result = safeReplaceWithText(el, 'Replaced');
      expect(result).toBe(true);
    });
  });

  describe('isLikelyAd — i18n text patterns', () => {
    it('detects French publicité', () => {
      const el = document.createElement('div');
      el.textContent = 'Ce contenu est une publicité';
      expect(isLikelyAd(el)).toBe(true);
    });

    it('detects French annonce sponsorisée', () => {
      const el = document.createElement('div');
      el.textContent = 'annonce sponsorisée par notre partenaire';
      expect(isLikelyAd(el)).toBe(true);
    });

    it('detects German Werbung', () => {
      const el = document.createElement('div');
      el.textContent = 'Werbung: Jetzt kaufen!';
      expect(isLikelyAd(el)).toBe(true);
    });

    it('detects German Anzeige', () => {
      const el = document.createElement('div');
      el.textContent = 'Anzeige – Sonderangebot';
      expect(isLikelyAd(el)).toBe(true);
    });

    it('detects Chinese 广告', () => {
      const el = document.createElement('div');
      el.textContent = '本页面包含广告内容';
      expect(isLikelyAd(el)).toBe(true);
    });

    it('detects Chinese 推广', () => {
      const el = document.createElement('div');
      el.textContent = '推广信息，点击查看';
      expect(isLikelyAd(el)).toBe(true);
    });

    it('detects Spanish publicidad', () => {
      const el = document.createElement('div');
      el.textContent = 'publicidad patrocinada';
      expect(isLikelyAd(el)).toBe(true);
    });

    it('detects Korean 광고', () => {
      const el = document.createElement('div');
      el.textContent = '광고 문의はこちら';
      expect(isLikelyAd(el)).toBe(true);
    });

    it('returns false for body text containing Accepter without cookie context', () => {
      const el = document.createElement('div');
      el.textContent = 'Nous devons accepter les différences culturelles.';
      // This text does not contain ad keywords; should not be ad
      expect(isLikelyAd(el)).toBe(false);
    });
  });

  describe('isLikelySocial — i18n text patterns', () => {
    it('detects French Partager', () => {
      const el = document.createElement('div');
      el.textContent = 'Partager sur Facebook';
      expect(isLikelySocial(el)).toBe(true);
    });

    it('detects French Suivez-nous', () => {
      const el = document.createElement('div');
      el.textContent = 'Suivez-nous sur Twitter';
      expect(isLikelySocial(el)).toBe(true);
    });

    it('detects German Teilen', () => {
      const el = document.createElement('div');
      el.textContent = 'Teilen Sie diesen Artikel';
      expect(isLikelySocial(el)).toBe(true);
    });

    it('detects German Folgen', () => {
      const el = document.createElement('div');
      el.textContent = 'Folgen Sie uns auf Instagram';
      expect(isLikelySocial(el)).toBe(true);
    });

    it('detects Chinese 分享', () => {
      const el = document.createElement('div');
      el.textContent = '分享到微信';
      expect(isLikelySocial(el)).toBe(true);
    });

    it('detects Chinese 关注我们', () => {
      const el = document.createElement('div');
      el.textContent = '关注我们获取更多信息';
      expect(isLikelySocial(el)).toBe(true);
    });

    it('detects Spanish Compartir', () => {
      const el = document.createElement('div');
      el.textContent = 'Compartir en redes sociales';
      expect(isLikelySocial(el)).toBe(true);
    });

    it('detects Korean 공유하기', () => {
      const el = document.createElement('div');
      el.textContent = '공유하기 버튼';
      expect(isLikelySocial(el)).toBe(true);
    });

    it('detects Korean 팔로우', () => {
      const el = document.createElement('div');
      el.textContent = '팔로우 해주세요';
      expect(isLikelySocial(el)).toBe(true);
    });

    it('returns false for normal article text', () => {
      const el = document.createElement('div');
      el.textContent = 'これは通常の記事本文です。広告や共有ボタンは含まれていません。';
      expect(isLikelySocial(el)).toBe(false);
    });

    it('detects fallback class share', () => {
      const el = document.createElement('div');
      el.className = 'share-buttons';
      el.textContent = 'some content';
      expect(isLikelySocial(el)).toBe(true);
    });
  });
});
