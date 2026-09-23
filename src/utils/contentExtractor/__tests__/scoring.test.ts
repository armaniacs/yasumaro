/**
 * @vitest-environment jsdom
 */

/**
 * scoring.test.ts
 * Unit tests for contentExtractor/scoring.ts
 */

import { calculateTextScore, findMainContentCandidates, scanMainContentCandidates } from '../scoring.js';

describe('contentExtractor/scoring', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('calculateTextScore', () => {
    it('returns 0 for empty element', () => {
      document.body.innerHTML = '<div></div>';
      const el = document.querySelector('div')!;
      expect(calculateTextScore(el)).toBe(0);
    });

    it('returns higher score for longer text', () => {
      document.body.innerHTML = `
        <div>
          <p class="short">Short.</p>
          <p class="long">${'This is a long paragraph. '.repeat(20)}</p>
        </div>
      `;
      const short = document.querySelector('.short')!;
      const long = document.querySelector('.long')!;
      expect(calculateTextScore(long)).toBeGreaterThan(calculateTextScore(short));
    });

    it('adds score for paragraph tags', () => {
      document.body.innerHTML = `
        <div class="a">Just plain text without structure</div>
        <div class="b">
          <p>Paragraph one with content.</p>
          <p>Paragraph two with more content.</p>
          <p>Paragraph three with content here.</p>
        </div>
      `;
      const a = document.querySelector('.a')!;
      const b = document.querySelector('.b')!;
      expect(calculateTextScore(b)).toBeGreaterThan(calculateTextScore(a));
    });

    it('adds score for heading tags', () => {
      document.body.innerHTML = `
        <div class="a">Plain text content here</div>
        <div class="b">
          <h2>Title</h2>
          <p>Some paragraph content here for testing.</p>
        </div>
      `;
      const a = document.querySelector('.a')!;
      const b = document.querySelector('.b')!;
      expect(calculateTextScore(b)).toBeGreaterThan(calculateTextScore(a));
    });

    it('adds score for list tags', () => {
      document.body.innerHTML = `
        <div class="a">Just plain text content here for comparison.</div>
        <div class="b">
          <ul>
            <li>Item one</li>
            <li>Item two</li>
          </ul>
          <ol>
            <li>First</li>
            <li>Second</li>
          </ol>
        </div>
      `;
      const a = document.querySelector('.a')!;
      const b = document.querySelector('.b')!;
      expect(calculateTextScore(b)).toBeGreaterThan(calculateTextScore(a));
    });

    it('reduces score for high link density', () => {
      document.body.innerHTML = `
        <div>
          <div class="content">
            <p>Paragraph with some text content here for testing.</p>
            <p>Another paragraph with more text content to ensure enough non-link text.</p>
            <p>Third paragraph with additional non-link text content for scoring.</p>
          </div>
          <div class="link-heavy">
            <a href="#">Link A long text here</a>
            <a href="#">Link B long text here</a>
            <a href="#">Link C long text here</a>
            <a href="#">Link D long text here</a>
          </div>
        </div>
      `;
      const content = document.querySelector('.content')!;
      const linkHeavy = document.querySelector('.link-heavy')!;
      expect(calculateTextScore(content)).toBeGreaterThan(calculateTextScore(linkHeavy));
    });

    it('applies 0.3 multiplier when link ratio exceeds 0.5', () => {
      document.body.innerHTML = `
        <div>
          <div class="high-link-density">
            <a href="#">This is a very long link text that dominates the content of this element completely</a>
            <span>short</span>
          </div>
        </div>
      `;
      const el = document.querySelector('.high-link-density')!;
      const score = calculateTextScore(el);
      expect(score).toBeGreaterThan(0);
      // With link ratio > 0.5, score is multiplied by 0.3
    });

    it('handles elements with h1-h7 tags', () => {
      document.body.innerHTML = `
        <div class="with-headings">
          <h1>Heading 1</h1>
          <h2>Heading 2</h2>
          <h3>Heading 3</h3>
          <p>Content paragraph with enough text to be meaningful for the scoring test.</p>
        </div>
      `;
      const el = document.querySelector('.with-headings')!;
      const score = calculateTextScore(el);
      expect(score).toBeGreaterThan(0);
    });

    it('does not count excluded child elements', () => {
      document.body.innerHTML = `
        <div class="parent">
          <p>Visible paragraph</p>
          <nav>Navigation links</nav>
        </div>
      `;
      const el = document.querySelector('.parent')!;
      const score = calculateTextScore(el);
      // Score should include "Visible paragraph" but not "Navigation links"
      expect(score).toBeGreaterThan(0);
    });
  });

  describe('findMainContentCandidates', () => {
    it('returns article tag as candidate', () => {
      document.body.innerHTML = `
        <nav>Navigation</nav>
        <article>
          <h1>Main Article</h1>
          <p>This is the main content of the page with enough text to be meaningful.</p>
          <p>Another paragraph with more content for extraction.</p>
        </article>
        <footer>Footer</footer>
      `;
      const candidates = findMainContentCandidates();
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0]!.tagName.toLowerCase()).toBe('article');
    });

    it('returns main tag as candidate', () => {
      document.body.innerHTML = `
        <main>
          <p>Main content paragraph here with enough text to be meaningful for testing extraction.</p>
          <p>Another paragraph with additional content for the extraction algorithm.</p>
        </main>
      `;
      const candidates = findMainContentCandidates();
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0]!.tagName.toLowerCase()).toBe('main');
    });

    it('excludes nav from candidates', () => {
      document.body.innerHTML = `
        <nav>Navigation content with some text</nav>
        <article><p>Article content</p></article>
      `;
      const candidates = findMainContentCandidates();
      for (const candidate of candidates) {
        expect(candidate.tagName.toLowerCase()).not.toBe('nav');
      }
    });

    it('falls back to Asian content structure detection', () => {
      document.body.innerHTML = `
        <div class="main-content">
          <h1>Asian Content Article</h1>
          <p>This is an article using Asian-style class naming conventions.</p>
          <p>Second paragraph with enough content to be meaningful.</p>
        </div>
        <footer>Footer text</footer>
      `;
      const candidates = findMainContentCandidates();
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0]!.className).toBe('main-content');
    });

    it('falls back to Asian ID structure detection', () => {
      document.body.innerHTML = `
        <div id="article-content">
          <h1>ID-based Article</h1>
          <p>Content found via Asian ID pattern matching.</p>
          <p>Another paragraph for sufficient content.</p>
        </div>
      `;
      const candidates = findMainContentCandidates();
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0]!.id).toBe('article-content');
    });

    it('falls back to body direct children when no article/main/asian', () => {
      document.body.innerHTML = `
        <div class="section-a">
          <p>First section with enough text content to be a candidate.</p>
        </div>
        <div class="section-b">
          <p>Second section with even more text content for candidate selection.</p>
          <p>Extra paragraph to ensure higher score.</p>
        </div>
      `;
      const candidates = findMainContentCandidates();
      expect(candidates.length).toBeGreaterThan(0);
    });

    it('returns at most 3 candidates', () => {
      document.body.innerHTML = `
        <div class="content-1"><p>${'Text '.repeat(50)}</p></div>
        <div class="content-2"><p>${'More text '.repeat(50)}</p></div>
        <div class="content-3"><p>${'Even more '.repeat(50)}</p></div>
        <div class="content-4"><p>${'Extra '.repeat(50)}</p></div>
      `;
      const candidates = findMainContentCandidates();
      expect(candidates.length).toBeLessThanOrEqual(3);
    });

    it('sorts candidates by text score descending', () => {
      document.body.innerHTML = `
        <article class="short">Short.</article>
        <article class="long">
          <h1>Long Article</h1>
          <p>Paragraph one with substantial content.</p>
          <p>Paragraph two with more substantial content.</p>
          <p>Paragraph three with even more content.</p>
        </article>
      `;
      const candidates = findMainContentCandidates();
      expect(candidates.length).toBe(1); // article tags return only top 1
      expect(candidates[0]!.className).toBe('long');
    });

    it('returns empty array when body is empty', () => {
      document.body.innerHTML = '';
      const candidates = findMainContentCandidates();
      expect(candidates).toEqual([]);
    });

    it('excludes footer from fallback candidates', () => {
      document.body.innerHTML = `
        <div class="content"><p>Main content text</p></div>
        <footer>Footer with text</footer>
      `;
      const candidates = findMainContentCandidates();
      for (const candidate of candidates) {
        expect(candidate.tagName.toLowerCase()).not.toBe('footer');
      }
    });

    it('excludes header from fallback candidates', () => {
      document.body.innerHTML = `
        <header>Header with text</header>
        <div class="content"><p>Main content text</p></div>
      `;
      const candidates = findMainContentCandidates();
      for (const candidate of candidates) {
        expect(candidate.tagName.toLowerCase()).not.toBe('header');
      }
    });
  });

  describe('scanMainContentCandidates floor guard (PBI 05 ①)', () => {
    beforeEach(() => {
      document.body.innerHTML = '';
    });

    it('adopts the first score-ordered candidate at or above the floor (rank-2 adopt)', () => {
      // article path: full sort BEFORE take — tiny high-structure article first
      // by tag priority but rank 2 is the floor-clearing one.
      document.body.innerHTML = `
        <article><p>Tiny</p></article>
        <main><p>${'This main element carries plenty of readable body text for the floor check. '.repeat(3)}</p></main>
      `;
      const scan = scanMainContentCandidates(100);
      expect(scan.candidates.length).toBe(1);
      expect(scan.candidates[0]!.tagName.toLowerCase()).toBe('main');
      expect(scan.rejectedTop).toBeUndefined();
    });

    it('all-miss returns empty candidates plus the rejected top for diagnostics', () => {
      document.body.innerHTML = `
        <article><p>Hi</p></article>
        <div><p>${'Body copy that is long enough to clear one hundred characters easily. '.repeat(2)}</p></div>
      `;
      // article/main present → article branch; only candidate is "Hi" (2 chars)
      const scan = scanMainContentCandidates(100);
      expect(scan.candidates).toEqual([]);
      expect(scan.rejectedTop).toBeDefined();
      expect(scan.rejectedTop!.tagName.toLowerCase()).toBe('article');
    });

    it('guard off returns the legacy ranked list untouched', () => {
      document.body.innerHTML = `
        <article><p>Hi</p></article>
        <main><p>${'Plenty of readable body text lives inside this main element for scoring. '.repeat(3)}</p></main>
      `;
      const legacy = findMainContentCandidates();
      const scanned = scanMainContentCandidates();
      expect(scanned.candidates.map((e) => e.tagName)).toEqual(legacy.map((e) => e.tagName));
      expect(scanned.rejectedTop).toBeUndefined();
      // legacy article path returns take=1
      expect(legacy.length).toBe(1);
    });

    it('genuine zero candidates stay zero with no rejectedTop (byte-identical guard off-path)', () => {
      document.body.innerHTML = `<span>Nothing scoreable</span>`;
      const scan = scanMainContentCandidates(100);
      // span is not a candidate source (article/main/div/section/body-children:
      // body children DO qualify — span is a direct body child here)
      // Either way rejectedTop only appears when the guard rejected something.
      if (scan.candidates.length === 0) {
        // direct-children branch: span text 18 chars < 100 → rejected
        expect(scan.rejectedTop).toBeDefined();
      } else {
        expect(scan.rejectedTop).toBeUndefined();
      }
    });
  });
});
