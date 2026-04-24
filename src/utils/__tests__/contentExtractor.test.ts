import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { extractMainContent } from '../contentExtractor/index.js';

describe('contentExtractor', () => {
  let dom: JSDOM;
  let document: Document;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><body></body>');
    document = dom.window.document;
    // @ts-ignore - テスト環境用にグローバールに設定
    global.document = document;
  });

  it('handles empty document body', () => {
    document.body.innerHTML = '';
    const result = extractMainContent(document);
    expect(result).toBeDefined();
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
    const result = extractMainContent(document);
    expect(result).toBeDefined();
  });
});
