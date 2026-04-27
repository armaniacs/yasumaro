// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { markBodyElements, unmarkBodyElements, isBodyProtected } from '../bodyProtection.js';

describe('bodyProtection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('markBodyElements', () => {
    it('marks elements with high readability score', () => {
      document.body.innerHTML = `
        <article class="main-content">
          <h1>Article Title</h1>
          <p>First paragraph with substantial content for scoring.</p>
          <p>Second paragraph with more text to increase score.</p>
          <p>Third paragraph to boost the paragraph count significantly.</p>
        </article>
      `;
      const article = document.querySelector('article')!;
      markBodyElements(document.body, 100);
      expect(article.getAttribute('data-ow-body-protected')).toBe('true');
    });

    it('does not mark elements with low readability score', () => {
      document.body.innerHTML = `
        <nav class="sidebar">
          <a href="#">Link 1</a>
          <a href="#">Link 2</a>
        </nav>
      `;
      const nav = document.querySelector('nav')!;
      markBodyElements(document.body, 200);
      expect(nav.getAttribute('data-ow-body-protected')).toBeNull();
    });

    it('uses default threshold when not specified', () => {
      document.body.innerHTML = `
        <div class="article-content">
          <h1>Title</h1>
          <p>Paragraph with content.</p>
          <p>Another paragraph.</p>
        </div>
      `;
      markBodyElements(document.body);
      const div = document.querySelector('div')!;
      // Default threshold is 200
      expect(div.getAttribute('data-ow-body-protected')).toBe('true');
    });

    it('marks multiple elements that meet threshold', () => {
      document.body.innerHTML = `
        <article>
          <h1>Article 1</h1>
          <p>Content paragraph 1.</p>
        </article>
        <section class="content">
          <h2>Section Title</h2>
          <p>Content paragraph 2.</p>
        </section>
      `;
      markBodyElements(document.body, 50);
      expect(document.querySelector('article')!.getAttribute('data-ow-body-protected')).toBe('true');
      expect(document.querySelector('section')!.getAttribute('data-ow-body-protected')).toBe('true');
    });

    it('only scans p, div, section, article elements', () => {
      document.body.innerHTML = `
        <header class="main-header">
          <h1>Header</h1>
        </header>
        <aside class="sidebar-content">
          <p>Sidebar content</p>
        </aside>
      `;
      markBodyElements(document.body, 100);
      // header and aside should not be scanned
      expect(document.querySelector('header')!.getAttribute('data-ow-body-protected')).toBeNull();
      expect(document.querySelector('aside')!.getAttribute('data-ow-body-protected')).toBeNull();
    });
  });

  describe('unmarkBodyElements', () => {
    it('removes protection markers from all marked elements', () => {
      document.body.innerHTML = `
        <article data-ow-body-protected="true">
          <p>Content</p>
        </article>
        <section data-ow-body-protected="true">
          <p>More content</p>
        </section>
      `;
      unmarkBodyElements(document.body);
      expect(document.querySelector('article')!.getAttribute('data-ow-body-protected')).toBeNull();
      expect(document.querySelector('section')!.getAttribute('data-ow-body-protected')).toBeNull();
    });

    it('does not affect elements without markers', () => {
      document.body.innerHTML = `
        <div class="normal-content">
          <p>Normal content</p>
        </div>
      `;
      unmarkBodyElements(document.body);
      expect(document.querySelector('div')!.getAttribute('data-ow-body-protected')).toBeNull();
    });

    it('handles empty DOM gracefully', () => {
      document.body.innerHTML = '';
      expect(() => unmarkBodyElements(document.body)).not.toThrow();
    });
  });

  describe('isBodyProtected', () => {
    it('returns true for directly protected element', () => {
      const el = document.createElement('div');
      el.setAttribute('data-ow-body-protected', 'true');
      document.body.appendChild(el);
      expect(isBodyProtected(el)).toBe(true);
    });

    it('returns true for child of protected element', () => {
      document.body.innerHTML = `
        <article data-ow-body-protected="true">
          <div>
            <p>Child paragraph</p>
          </div>
        </article>
      `;
      const p = document.querySelector('p')!;
      expect(isBodyProtected(p)).toBe(true);
    });

    it('returns false for unprotected element', () => {
      const el = document.createElement('div');
      el.textContent = 'Normal content';
      document.body.appendChild(el);
      expect(isBodyProtected(el)).toBe(false);
    });

    it('returns false for child of unprotected element', () => {
      document.body.innerHTML = `
        <div class="normal-content">
          <p>Child paragraph</p>
        </div>
      `;
      const p = document.querySelector('p')!;
      expect(isBodyProtected(p)).toBe(false);
    });

    it('handles nested protected elements', () => {
      document.body.innerHTML = `
        <article data-ow-body-protected="true">
          <section data-ow-body-protected="true">
            <p>Deep nested paragraph</p>
          </section>
        </article>
      `;
      const p = document.querySelector('p')!;
      expect(isBodyProtected(p)).toBe(true);
    });
  });

  describe('integration: mark and unmark lifecycle', () => {
    it('properly marks and unmarks elements', () => {
      document.body.innerHTML = `
        <article class="main-content">
          <h1>Article</h1>
          <p>Paragraph 1</p>
          <p>Paragraph 2</p>
        </article>
      `;
      const article = document.querySelector('article')!;
      
      // Mark
      markBodyElements(document.body, 100);
      expect(article.getAttribute('data-ow-body-protected')).toBe('true');
      expect(isBodyProtected(article)).toBe(true);
      
      // Unmark
      unmarkBodyElements(document.body);
      expect(article.getAttribute('data-ow-body-protected')).toBeNull();
      expect(isBodyProtected(article)).toBe(false);
    });
  });
});
