// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { extractMainContent } from '../index.js';

describe('extractMainContent - edge cases', () => {
  it('handles empty document body', () => {
    document.body.innerHTML = '';
    const result = extractMainContent();
    expect(typeof result).toBe('string');
  });

  it('extracts content from article element', () => {
    document.body.innerHTML = `
      <article>
        <h1>Test Article</h1>
        <p>This is a paragraph with enough content to be extracted properly.
           It should be longer than the minimum threshold for extraction.</p>
        <p>Another paragraph with meaningful content.</p>
      </article>
    `;
    const result = extractMainContent(10000, { returnInfo: true });
    expect(result).toBeDefined();
    if (typeof result === 'object') {
      expect(typeof result.content).toBe('string');
      expect(result.content.length).toBeGreaterThan(0);
    }
  });
});
