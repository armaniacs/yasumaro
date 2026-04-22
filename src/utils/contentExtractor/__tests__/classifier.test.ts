/**
 * @vitest-environment jsdom
 */

/**
 * classifier.test.ts
 * Unit tests for contentExtractor/classifier.ts
 */

import {
  EXCLUDED_ROLES,
  EXCLUDED_TAGS,
  EXCLUDED_CLASS_PATTERNS,
  ASIA_CONTENT_CLASS_PATTERNS,
  ASIA_CONTENT_ID_PATTERNS,
  isExcludedElement,
  isAsianContentElement,
} from '../classifier.js';

describe('contentExtractor/classifier', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('constants', () => {
    it('EXCLUDED_ROLES contains expected roles', () => {
      expect(EXCLUDED_ROLES.has('navigation')).toBe(true);
      expect(EXCLUDED_ROLES.has('banner')).toBe(true);
      expect(EXCLUDED_ROLES.has('contentinfo')).toBe(true);
      expect(EXCLUDED_ROLES.has('complementary')).toBe(true);
      expect(EXCLUDED_ROLES.has('doc-credit')).toBe(true);
      expect(EXCLUDED_ROLES.has('doc-endnotes')).toBe(true);
      expect(EXCLUDED_ROLES.has('doc-footnotes')).toBe(true);
    });

    it('EXCLUDED_TAGS contains expected tags', () => {
      expect(EXCLUDED_TAGS.has('nav')).toBe(true);
      expect(EXCLUDED_TAGS.has('aside')).toBe(true);
      expect(EXCLUDED_TAGS.has('footer')).toBe(true);
      expect(EXCLUDED_TAGS.has('header')).toBe(true);
    });

    it('EXCLUDED_CLASS_PATTERNS contains expected patterns', () => {
      expect(EXCLUDED_CLASS_PATTERNS).toContain('sidebar');
      expect(EXCLUDED_CLASS_PATTERNS).toContain('nav');
      expect(EXCLUDED_CLASS_PATTERNS).toContain('navigation');
      expect(EXCLUDED_CLASS_PATTERNS).toContain('menu');
      expect(EXCLUDED_CLASS_PATTERNS).toContain('breadcrumb');
      expect(EXCLUDED_CLASS_PATTERNS).toContain('cookie');
      expect(EXCLUDED_CLASS_PATTERNS).toContain('ad');
      expect(EXCLUDED_CLASS_PATTERNS).toContain('advertisement');
      expect(EXCLUDED_CLASS_PATTERNS).toContain('banner');
      expect(EXCLUDED_CLASS_PATTERNS).toContain('footer');
      expect(EXCLUDED_CLASS_PATTERNS).toContain('header');
    });

    it('ASIA_CONTENT_CLASS_PATTERNS contains expected patterns', () => {
      expect(ASIA_CONTENT_CLASS_PATTERNS).toContain('content');
      expect(ASIA_CONTENT_CLASS_PATTERNS).toContain('article');
      expect(ASIA_CONTENT_CLASS_PATTERNS).toContain('post');
      expect(ASIA_CONTENT_CLASS_PATTERNS).toContain('entry');
      expect(ASIA_CONTENT_CLASS_PATTERNS).toContain('article-body');
      expect(ASIA_CONTENT_CLASS_PATTERNS).toContain('article-content');
    });

    it('ASIA_CONTENT_ID_PATTERNS contains expected patterns', () => {
      expect(ASIA_CONTENT_ID_PATTERNS).toContain('content');
      expect(ASIA_CONTENT_ID_PATTERNS).toContain('article');
      expect(ASIA_CONTENT_ID_PATTERNS).toContain('post');
      expect(ASIA_CONTENT_ID_PATTERNS).toContain('entry');
      expect(ASIA_CONTENT_ID_PATTERNS).toContain('main');
    });
  });

  describe('isExcludedElement', () => {
    it('excludes nav element', () => {
      document.body.innerHTML = '<nav>Navigation</nav>';
      const el = document.querySelector('nav')!;
      expect(isExcludedElement(el)).toBe(true);
    });

    it('excludes aside element', () => {
      document.body.innerHTML = '<aside>Sidebar</aside>';
      const el = document.querySelector('aside')!;
      expect(isExcludedElement(el)).toBe(true);
    });

    it('excludes footer element', () => {
      document.body.innerHTML = '<footer>Footer</footer>';
      const el = document.querySelector('footer')!;
      expect(isExcludedElement(el)).toBe(true);
    });

    it('excludes header element', () => {
      document.body.innerHTML = '<header>Header</header>';
      const el = document.querySelector('header')!;
      expect(isExcludedElement(el)).toBe(true);
    });

    it('excludes elements with role="navigation"', () => {
      document.body.innerHTML = '<div role="navigation">Nav</div>';
      const el = document.querySelector('[role="navigation"]')!;
      expect(isExcludedElement(el)).toBe(true);
    });

    it('excludes elements with role="banner"', () => {
      document.body.innerHTML = '<div role="banner">Banner</div>';
      const el = document.querySelector('[role="banner"]')!;
      expect(isExcludedElement(el)).toBe(true);
    });

    it('excludes elements with role="contentinfo"', () => {
      document.body.innerHTML = '<div role="contentinfo">Footer</div>';
      const el = document.querySelector('[role="contentinfo"]')!;
      expect(isExcludedElement(el)).toBe(true);
    });

    it('excludes elements with aria-hidden="true"', () => {
      document.body.innerHTML = '<div aria-hidden="true">Hidden</div>';
      const el = document.querySelector('[aria-hidden="true"]')!;
      expect(isExcludedElement(el)).toBe(true);
    });

    it('excludes elements with sidebar class', () => {
      document.body.innerHTML = '<div class="sidebar">Sidebar</div>';
      const el = document.querySelector('.sidebar')!;
      expect(isExcludedElement(el)).toBe(true);
    });

    it('excludes elements with navigation class', () => {
      document.body.innerHTML = '<div class="main-navigation">Navigation</div>';
      const el = document.querySelector('.main-navigation')!;
      expect(isExcludedElement(el)).toBe(true);
    });

    it('excludes elements with menu class', () => {
      document.body.innerHTML = '<div class="dropdown-menu">Menu</div>';
      const el = document.querySelector('.dropdown-menu')!;
      expect(isExcludedElement(el)).toBe(true);
    });

    it('excludes elements with breadcrumb class', () => {
      document.body.innerHTML = '<div class="breadcrumb">Home > About</div>';
      const el = document.querySelector('.breadcrumb')!;
      expect(isExcludedElement(el)).toBe(true);
    });

    it('excludes elements with cookie class', () => {
      document.body.innerHTML = '<div class="cookie-banner">Cookies</div>';
      const el = document.querySelector('.cookie-banner')!;
      expect(isExcludedElement(el)).toBe(true);
    });

    it('excludes elements with ad class', () => {
      document.body.innerHTML = '<div class="ad-container">Ad</div>';
      const el = document.querySelector('.ad-container')!;
      expect(isExcludedElement(el)).toBe(true);
    });

    it('excludes elements with advertisement class', () => {
      document.body.innerHTML = '<div class="advertisement">Ad</div>';
      const el = document.querySelector('.advertisement')!;
      expect(isExcludedElement(el)).toBe(true);
    });

    it('excludes elements with banner class', () => {
      document.body.innerHTML = '<div class="top-banner">Banner</div>';
      const el = document.querySelector('.top-banner')!;
      expect(isExcludedElement(el)).toBe(true);
    });

    it('does not exclude p element', () => {
      document.body.innerHTML = '<p>Paragraph</p>';
      const el = document.querySelector('p')!;
      expect(isExcludedElement(el)).toBe(false);
    });

    it('does not exclude article element', () => {
      document.body.innerHTML = '<article>Article</article>';
      const el = document.querySelector('article')!;
      expect(isExcludedElement(el)).toBe(false);
    });

    it('does not exclude div element without excluded attributes', () => {
      document.body.innerHTML = '<div class="content">Content</div>';
      const el = document.querySelector('.content')!;
      expect(isExcludedElement(el)).toBe(false);
    });

    it('is case-insensitive for class names', () => {
      document.body.innerHTML = '<div class="SIDEBAR">Sidebar</div>';
      const el = document.querySelector('div')!;
      expect(isExcludedElement(el)).toBe(true);
    });
  });

  describe('isAsianContentElement', () => {
    it('returns true for content class', () => {
      document.body.innerHTML = '<div class="main-content">Content</div>';
      const el = document.querySelector('.main-content')!;
      expect(isAsianContentElement(el)).toBe(true);
    });

    it('returns true for article class', () => {
      document.body.innerHTML = '<div class="article-body">Content</div>';
      const el = document.querySelector('.article-body')!;
      expect(isAsianContentElement(el)).toBe(true);
    });

    it('returns true for post-content class', () => {
      document.body.innerHTML = '<div class="post-content">Content</div>';
      const el = document.querySelector('.post-content')!;
      expect(isAsianContentElement(el)).toBe(true);
    });

    it('returns true for entry-content class', () => {
      document.body.innerHTML = '<div class="entry-content">Content</div>';
      const el = document.querySelector('.entry-content')!;
      expect(isAsianContentElement(el)).toBe(true);
    });

    it('returns true for article-content ID', () => {
      document.body.innerHTML = '<div id="article-content">Content</div>';
      const el = document.querySelector('#article-content')!;
      expect(isAsianContentElement(el)).toBe(true);
    });

    it('returns true for content-main ID (content- prefix)', () => {
      document.body.innerHTML = '<div id="content-main">Content</div>';
      const el = document.querySelector('#content-main')!;
      expect(isAsianContentElement(el)).toBe(true);
    });

    it('returns true for main-content ID (-content suffix)', () => {
      document.body.innerHTML = '<div id="main-content">Content</div>';
      const el = document.querySelector('#main-content')!;
      expect(isAsianContentElement(el)).toBe(true);
    });

    it('returns true for exact match ID like "main"', () => {
      document.body.innerHTML = '<div id="main">Content</div>';
      const el = document.querySelector('#main')!;
      expect(isAsianContentElement(el)).toBe(true);
    });

    it('returns true for TRS_Editor class', () => {
      document.body.innerHTML = '<div class="TRS_Editor">Content</div>';
      const el = document.querySelector('.TRS_Editor')!;
      expect(isAsianContentElement(el)).toBe(true);
    });

    it('returns false for random class and ID', () => {
      document.body.innerHTML = '<div class="random-class" id="random-id">Content</div>';
      const el = document.querySelector('.random-class')!;
      expect(isAsianContentElement(el)).toBe(false);
    });

    it('returns false when document is undefined', () => {
      const originalDocument = global.document;
      const el = document.createElement('div');
      el.className = 'article-content';
      // @ts-expect-error - simulate non-DOM environment
      global.document = undefined;
      const result = isAsianContentElement(el);
      global.document = originalDocument;
      expect(result).toBe(false);
    });

    it('is case-insensitive for class names', () => {
      document.body.innerHTML = '<div class="ARTICLE-BODY">Content</div>';
      const el = document.querySelector('div')!;
      expect(isAsianContentElement(el)).toBe(true);
    });
  });
});
