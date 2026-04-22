/**
 * @vitest-environment jsdom
 */

/**
 * textExtraction.test.ts
 * Unit tests for contentExtractor/textExtraction.ts
 */

import { extractTextFromElement } from '../textExtraction.js';

describe('contentExtractor/textExtraction', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('extractTextFromElement', () => {
    it('extracts text from a simple paragraph', () => {
      document.body.innerHTML = '<p>Hello world</p>';
      const el = document.querySelector('p')!;
      expect(extractTextFromElement(el)).toBe('Hello world');
    });

    it('extracts text from nested elements', () => {
      document.body.innerHTML = '<div><p>First</p><p>Second</p></div>';
      const el = document.querySelector('div')!;
      const text = extractTextFromElement(el);
      expect(text).toContain('First');
      expect(text).toContain('Second');
    });

    it('skips img tags', () => {
      document.body.innerHTML = '<p>Before <img src="test.jpg" alt="Test"> After</p>';
      const el = document.querySelector('p')!;
      const text = extractTextFromElement(el);
      expect(text).toContain('Before');
      expect(text).toContain('After');
      expect(text).not.toContain('Test');
    });

    it('skips excluded child elements', () => {
      document.body.innerHTML = `
        <article>
          <p>Main content</p>
          <nav>Navigation</nav>
          <p>More content</p>
        </article>
      `;
      const el = document.querySelector('article')!;
      const text = extractTextFromElement(el);
      expect(text).toContain('Main content');
      expect(text).toContain('More content');
      expect(text).not.toContain('Navigation');
    });

    it('skips aside elements', () => {
      document.body.innerHTML = `
        <div>
          <p>Main text</p>
          <aside>Sidebar content</aside>
        </div>
      `;
      const el = document.querySelector('div')!;
      const text = extractTextFromElement(el);
      expect(text).toContain('Main text');
      expect(text).not.toContain('Sidebar content');
    });

    it('skips footer elements', () => {
      document.body.innerHTML = `
        <div>
          <p>Article body</p>
          <footer>Footer text</footer>
        </div>
      `;
      const el = document.querySelector('div')!;
      const text = extractTextFromElement(el);
      expect(text).toContain('Article body');
      expect(text).not.toContain('Footer text');
    });

    it('skips header elements', () => {
      document.body.innerHTML = `
        <div>
          <header>Header text</header>
          <p>Article body</p>
        </div>
      `;
      const el = document.querySelector('div')!;
      const text = extractTextFromElement(el);
      expect(text).toContain('Article body');
      expect(text).not.toContain('Header text');
    });

    it('handles deeply nested structures', () => {
      document.body.innerHTML = `
        <div>
          <section>
            <p>Deeply <strong>nested</strong> content</p>
          </section>
        </div>
      `;
      const el = document.querySelector('div')!;
      const text = extractTextFromElement(el);
      expect(text).toContain('Deeply');
      expect(text).toContain('nested');
      expect(text).toContain('content');
    });

    it('returns empty string for empty element', () => {
      document.body.innerHTML = '<div></div>';
      const el = document.querySelector('div')!;
      expect(extractTextFromElement(el)).toBe('');
    });

    it('handles text nodes mixed with elements', () => {
      document.body.innerHTML = '<p>Text before <span>span content</span> text after</p>';
      const el = document.querySelector('p')!;
      const text = extractTextFromElement(el);
      expect(text).toContain('Text before');
      expect(text).toContain('span content');
      expect(text).toContain('text after');
    });

    it('skips elements with role="navigation"', () => {
      document.body.innerHTML = `
        <div>
          <div role="navigation">Nav links</div>
          <p>Main text</p>
        </div>
      `;
      const el = document.querySelector('div')!;
      const text = extractTextFromElement(el);
      expect(text).toContain('Main text');
      expect(text).not.toContain('Nav links');
    });

    it('skips elements with aria-hidden="true"', () => {
      document.body.innerHTML = `
        <div>
          <p>Visible text</p>
          <p aria-hidden="true">Hidden text</p>
        </div>
      `;
      const el = document.querySelector('div')!;
      const text = extractTextFromElement(el);
      expect(text).toContain('Visible text');
      expect(text).not.toContain('Hidden text');
    });

    it('handles multiple img tags', () => {
      document.body.innerHTML = `
        <article>
          <img src="a.jpg" alt="First">
          <p>Between images</p>
          <img src="b.jpg" alt="Second">
        </article>
      `;
      const el = document.querySelector('article')!;
      const text = extractTextFromElement(el);
      expect(text).toContain('Between images');
      expect(text).not.toContain('First');
      expect(text).not.toContain('Second');
    });

    it('preserves text structure with spaces between elements', () => {
      document.body.innerHTML = '<div><span>A</span><span>B</span></div>';
      const el = document.querySelector('div')!;
      const text = extractTextFromElement(el);
      expect(text).toContain('A');
      expect(text).toContain('B');
    });

    it('handles elements with class-based exclusion', () => {
      document.body.innerHTML = `
        <div>
          <p>Visible content</p>
          <div class="sidebar">Sidebar content</div>
        </div>
      `;
      const el = document.querySelector('div')!;
      const text = extractTextFromElement(el);
      expect(text).toContain('Visible content');
      expect(text).not.toContain('Sidebar content');
    });
  });
});
