// @vitest-environment jsdom
/**
 * index-batch-d.test.ts — PBI 2026-11-08-16 (item 1) pins.
 *
 * The four `maxChars` defaults (plus preparePageContent's) share the single
 * DEFAULT_EXTRACT_MAX_CHARS definition with the long-standing value 10000.
 * These tests pin the value and that every default entry point truncates a
 * long extraction at exactly the shared constant.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  extract,
  extractMainContent,
  extractMainContentWithInfo,
  DEFAULT_EXTRACT_MAX_CHARS,
} from '../index.js';
import { preparePageContent } from '../../pageContentPipeline.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

function fillBodyWithLongText(): void {
  document.body.innerHTML = `<article><p>${'a'.repeat(DEFAULT_EXTRACT_MAX_CHARS + 5000)}</p></article>`;
}

describe('DEFAULT_EXTRACT_MAX_CHARS (PBI 2026-11-08-16 item 1)', () => {
  it('is the long-standing 10000 default', () => {
    expect(DEFAULT_EXTRACT_MAX_CHARS).toBe(10000);
  });

  it('caps extractMainContent at the shared default', () => {
    fillBodyWithLongText();
    expect(extractMainContent().length).toBe(DEFAULT_EXTRACT_MAX_CHARS);
  });

  it('caps extractMainContentWithInfo at the shared default', () => {
    fillBodyWithLongText();
    const result = extractMainContentWithInfo();
    expect(result.content).toHaveLength(DEFAULT_EXTRACT_MAX_CHARS);
  });

  it('caps extract with a default config at the shared default', () => {
    fillBodyWithLongText();
    expect(extract().content).toHaveLength(DEFAULT_EXTRACT_MAX_CHARS);
  });

  it('caps preparePageContent at the shared default', () => {
    fillBodyWithLongText();
    expect(preparePageContent().content).toHaveLength(DEFAULT_EXTRACT_MAX_CHARS);
  });
});
