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

  it('Scenario: prepares page content via a single seam — returns PageContent with content', async () => {
    dom.window.document.body.innerHTML = `
      <article>
        <h1>Hello Yasumaro</h1>
        <p>This is a meaningful paragraph that should be extracted as main content. It has more than one hundred characters to pass the fallback threshold and ensure it is not considered too short.</p>
        <p>Second paragraph with additional content for extraction.</p>
      </article>
    `;
    const config = new PageState().cleansingConfig;
    const result = await preparePageContent(config);
    expect(result).toBeDefined();
    expect(typeof result.content).toBe('string');
    expect(result.content.length).toBeGreaterThan(0);
    // Caller does not need to know about optionBuilder / classifier internals
    expect(result.content).toContain('Hello Yasumaro');
  });

  it('Scenario: handles site-specific patterns internally — cleansing runs without error', async () => {
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
    const result = await preparePageContent(config);
    // main content should remain; pipeline runs without throwing
    expect(result.content).toContain('Main content paragraph');
    expect(result.content).toContain('Another main content paragraph');
    expect(typeof result.content).toBe('string');
  });

  it('Scenario: guarantees purity — same input yields same output', async () => {
    dom.window.document.body.innerHTML = `
      <article><p>Deterministic content paragraph with enough length to avoid fallback logic and ensure stable extraction.</p></article>
    `;
    const config = new PageState().cleansingConfig;
    const a = await preparePageContent(config);
    // Reset DOM to same content and call again
    dom.window.document.body.innerHTML = `
      <article><p>Deterministic content paragraph with enough length to avoid fallback logic and ensure stable extraction.</p></article>
    `;
    const b = await preparePageContent(config);
    expect(a.content).toBe(b.content);
    expect(a.cleansedReason).toBe(b.cleansedReason);
  });

  it('Scenario: does not crash on invalid HTML — empty / malformed', async () => {
    // Empty body (PBI 1116b: the seam is async now — "does not crash" means
    // the promise resolves instead of rejecting; a rejection fails the test)
    dom.window.document.body.innerHTML = '';
    const config = new PageState().cleansingConfig;
    const emptyResult = await preparePageContent(config);
    expect(typeof emptyResult.content).toBe('string');

    // Malformed HTML (unclosed tags)
    dom.window.document.body.innerHTML = '<div><p>Unclosed div and paragraph';
    const malformed = await preparePageContent(config);
    expect(typeof malformed.content).toBe('string');

    // Huge HTML (1k paragraphs — simulates ~1MB)
    const huge = '<p>' + 'x'.repeat(100) + '</p>';
    dom.window.document.body.innerHTML = huge.repeat(200);
    const hugeResult = await preparePageContent(config, 5000);
    expect(hugeResult.content.length).toBeLessThanOrEqual(5000);
  });

  it('hides optionBuilder — caller does not construct cleanseOptions manually', async () => {
    const config = new PageState().cleansingConfig;
    config.contentStripHardEnabled = true;
    config.contentStripKeywordEnabled = false;
    // The old call required: buildExtractionOptions(config) → extractMainContent(...)
    // New call is one seam:
    const result = await preparePageContent(config);
    expect(result).toBeDefined();
    expect(typeof result.content).toBe('string');
  });

  it('respects maxChars truncation', async () => {
    dom.window.document.body.innerHTML = `<article><p>${'a'.repeat(20000)}</p></article>`;
    const config = new PageState().cleansingConfig;
    const result = await preparePageContent(config, 100);
    expect(result.content.length).toBeLessThanOrEqual(100);
  });
});
