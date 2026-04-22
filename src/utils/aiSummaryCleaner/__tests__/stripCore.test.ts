// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { stripCardElements, CARD_PATTERNS } from '../stripCore.js';

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
