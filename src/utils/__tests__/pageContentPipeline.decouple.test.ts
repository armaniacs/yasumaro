import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import * as fs from 'fs';
import * as path from 'path';
import { preparePageContent } from '../pageContentPipeline.js';
import { PageState, DEFAULT_CLEANSING_CONFIG } from '../../content/pageState.js';
import {
  DEFAULT_CLEANSING_CONFIG as UTILS_DEFAULT_CLEANSING_CONFIG,
  createDefaultCleansingConfig,
} from '../cleansingConfig.js';

const PIPELINE_PATH = path.resolve(__dirname, '..', 'pageContentPipeline.ts');

const ARTICLE_HTML = `
  <article>
    <h1>Decouple Article</h1>
    <p>This is a meaningful paragraph that should be extracted as main content. It has more than one hundred characters to pass the fallback threshold and ensure it is not considered too short.</p>
    <p>Second paragraph with additional content for extraction.</p>
  </article>
`;

function setBody(dom: JSDOM, html: string): void {
  dom.window.document.body.innerHTML = html;
}

/** Non-type static imports in `source` whose specifier reaches into src/content/. */
function contentRuntimeImports(source: string): string[] {
  return source.split('\n').filter((line) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return false;
    if (/^import\s+type\s+/.test(trimmed)) return false; // erased at compile time
    const match = trimmed.match(/^import\s[^'"]*from\s+['"]([^'"]+)['"]/);
    if (!match) return false;
    return (match[1] ?? '').includes('/content/');
  });
}

describe('pageContentPipeline decouple — behavior pins (PBI 2026-09-21-16)', () => {
  let dom: JSDOM;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    // @ts-ignore — jsdom globals for contentExtractor
    global.document = dom.window.document;
    // @ts-ignore
    global.window = dom.window as unknown as Window & typeof globalThis;
    // @ts-ignore
    global.chrome = undefined;
  });

  it('no-arg call resolves the same result as an explicit fresh PageState config', () => {
    setBody(dom, ARTICLE_HTML);
    const fromDefault = preparePageContent();
    setBody(dom, ARTICLE_HTML);
    const fromExplicit = preparePageContent(new PageState().cleansingConfig);
    expect(fromDefault).toEqual(fromExplicit);
  });

  it('output shape is unchanged between default and explicit config', () => {
    setBody(dom, ARTICLE_HTML);
    const fromDefault = preparePageContent();
    setBody(dom, ARTICLE_HTML);
    const fromExplicit = preparePageContent(new PageState().cleansingConfig);
    expect(Object.keys(fromDefault).sort()).toEqual(Object.keys(fromExplicit).sort());
    expect(typeof fromDefault.content).toBe('string');
    expect(fromDefault.content).toContain('Decouple Article');
  });

  it('fresh PageState config matches DEFAULT_CLEANSING_CONFIG (the default construction the pipeline needs)', () => {
    expect(new PageState().cleansingConfig).toEqual(DEFAULT_CLEANSING_CONFIG);
    // Fresh copies own their arrays — pipeline callers cannot mutate the shared default
    const fresh = new PageState().cleansingConfig;
    expect(fresh.contentStripKeywords).not.toBe(DEFAULT_CLEANSING_CONFIG.contentStripKeywords);
    expect(fresh.aiSummaryCleansingCustomPatterns).not.toBe(
      DEFAULT_CLEANSING_CONFIG.aiSummaryCleansingCustomPatterns,
    );
  });

  it('explicit config still flows through buildExtractionOptions unchanged', () => {
    setBody(dom, ARTICLE_HTML);
    const config = new PageState().cleansingConfig;
    config.contentStripHardEnabled = false;
    const result = preparePageContent(config);
    expect(typeof result.content).toBe('string');
    expect(result.content).toContain('Decouple Article');
  });

  it('regression: pipeline has no runtime import reaching into src/content/', () => {
    const source = fs.readFileSync(PIPELINE_PATH, 'utf8');
    expect(contentRuntimeImports(source)).toEqual([]);
  });

  it('utils owns the default: createDefaultCleansingConfig matches fresh PageState config', () => {
    expect(createDefaultCleansingConfig()).toEqual(new PageState().cleansingConfig);
    expect(UTILS_DEFAULT_CLEANSING_CONFIG).toBe(DEFAULT_CLEANSING_CONFIG);
  });
});
