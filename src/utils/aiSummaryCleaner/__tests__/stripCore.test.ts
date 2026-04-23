// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { stripCardElements, CARD_PATTERNS, stripJsonLdScripts, stripLazyLoadElements, stripSkipLinks } from '../stripCore.js';

describe('stripCardElements', () => {
  it('removes elements matching card patterns', () => {
    document.body.innerHTML = `
      <div>
        <div class="article-card">Related article</div>
        <p>Main content paragraph with enough text to be relevant.</p>
      </div>
    `;
    const removed = stripCardElements(document.body);
    expect(removed).toBeGreaterThan(0);
    expect(document.querySelector('.article-card')).toBeNull();
  });

  it('returns 0 when no card elements exist', () => {
    document.body.innerHTML = `
      <article>
        <p>Normal content without any card patterns.</p>
      </article>
    `;
    const removed = stripCardElements(document.body);
    expect(removed).toBe(0);
  });
});

describe('CARD_PATTERNS', () => {
  it('contains expected patterns', () => {
    expect(CARD_PATTERNS).toContain('card');
    expect(CARD_PATTERNS).toContain('article-card');
    expect(Array.isArray(CARD_PATTERNS)).toBe(true);
    expect(CARD_PATTERNS.length).toBeGreaterThan(0);
  });
});

describe('stripJsonLdScripts', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('removes JSON-LD script elements', () => {
    document.body.innerHTML = `
      <div>
        <script type="application/ld+json">{"@type":"Article"}</script>
        <script type="application/ld+json">{"@type":"BreadcrumbList"}</script>
        <p>Main content</p>
      </div>
    `;
    const removed = stripJsonLdScripts(document.body);
    expect(removed).toBe(2);
    expect(document.querySelectorAll('script[type="application/ld+json"]').length).toBe(0);
  });

  it('returns 0 when no JSON-LD scripts exist', () => {
    document.body.innerHTML = `<article><p>Content without structured data.</p></article>`;
    const removed = stripJsonLdScripts(document.body);
    expect(removed).toBe(0);
  });

  it('does not remove non-JSON-LD scripts', () => {
    document.body.innerHTML = `
      <div>
        <script type="text/javascript">console.log('keep')</script>
        <p>Content</p>
      </div>
    `;
    const removed = stripJsonLdScripts(document.body);
    expect(removed).toBe(0);
    expect(document.querySelector('script[type="text/javascript"]')).not.toBeNull();
  });
});

describe('stripLazyLoadElements', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('removes elements with loading="lazy"', () => {
    document.body.innerHTML = `
      <div>
        <img loading="lazy" src="photo.jpg" alt="lazy image">
        <p>Main content paragraph here.</p>
      </div>
    `;
    const removed = stripLazyLoadElements(document.body);
    expect(removed).toBeGreaterThan(0);
    expect(document.querySelector('[loading="lazy"]')).toBeNull();
  });

  it('removes elements with data-src attribute', () => {
    document.body.innerHTML = `
      <div>
        <img data-src="lazy.jpg" alt="data-src image">
        <p>Content paragraph</p>
      </div>
    `;
    const removed = stripLazyLoadElements(document.body);
    expect(removed).toBeGreaterThan(0);
  });

  it('removes elements with lazy/skeleton class patterns', () => {
    document.body.innerHTML = `
      <div>
        <div class="skeleton-loader">Loading...</div>
        <div class="lazy-placeholder">Placeholder</div>
        <p>Main content</p>
      </div>
    `;
    const removed = stripLazyLoadElements(document.body);
    expect(removed).toBeGreaterThan(0);
  });

  it('returns 0 when no lazy elements exist', () => {
    document.body.innerHTML = `<article><p>Regular content with no lazy elements.</p></article>`;
    const removed = stripLazyLoadElements(document.body);
    expect(removed).toBe(0);
  });
});

describe('stripSkipLinks', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('removes anchor links starting with #', () => {
    document.body.innerHTML = `
      <div>
        <a href="#main-content">Skip to main content</a>
        <a href="#nav">Skip to nav</a>
        <p>Main content paragraph</p>
      </div>
    `;
    const removed = stripSkipLinks(document.body);
    expect(removed).toBeGreaterThan(0);
    expect(document.querySelector('a[href^="#"]')).toBeNull();
  });

  it('removes javascript: links', () => {
    document.body.innerHTML = `
      <div>
        <a href="javascript:void(0)">Click me</a>
        <p>Content</p>
      </div>
    `;
    const removed = stripSkipLinks(document.body);
    expect(removed).toBeGreaterThan(0);
  });

  it('removes role="button" links', () => {
    document.body.innerHTML = `
      <div>
        <a role="button" href="#">Open modal</a>
        <p>Content</p>
      </div>
    `;
    const removed = stripSkipLinks(document.body);
    expect(removed).toBeGreaterThan(0);
  });

  it('removes elements with sr-only/visually-hidden class', () => {
    document.body.innerHTML = `
      <div>
        <span class="sr-only">Screen reader text</span>
        <span class="visually-hidden">Hidden text</span>
        <p>Visible content</p>
      </div>
    `;
    const removed = stripSkipLinks(document.body);
    expect(removed).toBeGreaterThan(0);
  });

  it('returns 0 when no skip links exist', () => {
    document.body.innerHTML = `
      <article>
        <a href="https://example.com">Regular link</a>
        <p>Normal content</p>
      </article>
    `;
    const removed = stripSkipLinks(document.body);
    expect(removed).toBe(0);
  });
});
