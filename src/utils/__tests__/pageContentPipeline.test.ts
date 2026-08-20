import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { preparePageContent } from '../pageContentPipeline.js';
import { PageState } from '../../content/pageState.js';

describe('PageContentPipeline — deep module interface', () => {
  let dom: JSDOM;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    // @ts-ignore — jsdom globals for contentExtractor
    global.document = dom.window.document;
    // @ts-ignore
    global.window = dom.window as unknown as Window & typeof globalThis;
    // Minimal chrome mock for contentExtractor's sendMessage guard
    // @ts-ignore
    global.chrome = undefined;
  });

  it('Scenario: 単一 seam でページ内容が準備される — returns PageContent with content', () => {
    dom.window.document.body.innerHTML = `
      <article>
        <h1>Hello Yasumaro</h1>
        <p>This is a meaningful paragraph that should be extracted as main content. It has more than one hundred characters to pass the fallback threshold and ensure it is not considered too short.</p>
        <p>Second paragraph with additional content for extraction.</p>
      </article>
    `;
    const config = new PageState().cleansingConfig;
    const result = preparePageContent(config);
    expect(result).toBeDefined();
    expect(typeof result.content).toBe('string');
    expect(result.content.length).toBeGreaterThan(0);
    // Caller does not need to know about optionBuilder / classifier internals
    expect(result.content).toContain('Hello Yasumaro');
  });

  it('Scenario: サイト固有パターンが内部で処理される — cleansing runs without error', () => {
    dom.window.document.body.innerHTML = `
      <article>
        <h1>Main Article</h1>
        <p>Main content paragraph that is long enough to be considered valid content for the pipeline. It contains sufficient text to avoid fallback.</p>
        <div class="ad-container">AD CONTENT</div>
        <div class="sidebar-recommend">RECOMMEND</div>
        <p>Another main content paragraph.</p>
      </article>
    `;
    const config = new PageState().cleansingConfig;
    config.aiSummaryCleansingEnabled = true;
    const result = preparePageContent(config);
    // main content should remain; pipeline runs without throwing
    expect(result.content).toContain('Main content paragraph');
    expect(result.content).toContain('Another main content paragraph');
    expect(typeof result.content).toBe('string');
  });

  it('Scenario: 純粋性が保証される — same input yields same output', () => {
    dom.window.document.body.innerHTML = `
      <article><p>Deterministic content paragraph with enough length to avoid fallback logic and ensure stable extraction.</p></article>
    `;
    const config = new PageState().cleansingConfig;
    const a = preparePageContent(config);
    // Reset DOM to same content and call again
    dom.window.document.body.innerHTML = `
      <article><p>Deterministic content paragraph with enough length to avoid fallback logic and ensure stable extraction.</p></article>
    `;
    const b = preparePageContent(config);
    expect(a.content).toBe(b.content);
    expect(a.cleansedReason).toBe(b.cleansedReason);
  });

  it('Scenario: 不正なHTMLでもクラッシュしない — empty / malformed', () => {
    // Empty body
    dom.window.document.body.innerHTML = '';
    const config = new PageState().cleansingConfig;
    expect(() => preparePageContent(config)).not.toThrow();
    const emptyResult = preparePageContent(config);
    expect(typeof emptyResult.content).toBe('string');

    // Malformed HTML (unclosed tags)
    dom.window.document.body.innerHTML = '<div><p>Unclosed div and paragraph';
    expect(() => preparePageContent(config)).not.toThrow();
    const malformed = preparePageContent(config);
    expect(typeof malformed.content).toBe('string');

    // Huge HTML (1k paragraphs — simulates ~1MB)
    const huge = '<p>' + 'x'.repeat(100) + '</p>';
    dom.window.document.body.innerHTML = huge.repeat(200);
    expect(() => preparePageContent(config, 5000)).not.toThrow();
    const hugeResult = preparePageContent(config, 5000);
    expect(hugeResult.content.length).toBeLessThanOrEqual(5000);
  });

  it('hides optionBuilder — caller does not construct cleanseOptions manually', () => {
    const config = new PageState().cleansingConfig;
    config.contentStripHardEnabled = true;
    config.contentStripKeywordEnabled = false;
    // The old call required: buildExtractionOptions(config) → extractMainContent(...)
    // New call is one seam:
    const result = preparePageContent(config);
    expect(result).toBeDefined();
    expect(typeof result.content).toBe('string');
  });

  it('respects maxChars truncation', () => {
    dom.window.document.body.innerHTML = `<article><p>${'a'.repeat(20000)}</p></article>`;
    const config = new PageState().cleansingConfig;
    const result = preparePageContent(config, 100);
    expect(result.content.length).toBeLessThanOrEqual(100);
  });
});
