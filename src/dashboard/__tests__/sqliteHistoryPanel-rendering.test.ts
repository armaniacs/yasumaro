// @vitest-environment jsdom
/**
 * sqliteHistoryPanel-rendering.test.ts
 * Tests for the diagnostic metadata rendering in sqliteHistoryPanel
 */
import { describe, it, expect } from 'vitest';
import { _test } from '../sqliteHistoryPanel.js';
import type { BrowsingLogEntry } from '../dashboardSqliteService.js';

const { formatDiagnosticMetadataHtml, buildCleansingProgressBarHtml } = _test;

describe('formatDiagnosticMetadataHtml', () => {
  it('returns empty string when no metric data is present', () => {
    const entry: BrowsingLogEntry = {
      id: 1,
      url: 'https://example.com',
      created_at: Date.now(),
    };
    const html = formatDiagnosticMetadataHtml(entry);
    expect(html).toBe('');
  });

  it('renders AI summary in styled box', () => {
    const entry: BrowsingLogEntry = {
      id: 1,
      url: 'https://example.com',
      created_at: Date.now(),
      summary: 'This is a test summary',
    };
    const html = formatDiagnosticMetadataHtml(entry);
    expect(html).toContain('history-entry-ai-summary');
    expect(html).toContain('This is a test summary');
  });

  it('renders token info with sent/received tokens, duration, and AI provider', () => {
    const entry: BrowsingLogEntry = {
      id: 1,
      url: 'https://example.com',
      created_at: Date.now(),
      sent_tokens: 328,
      received_tokens: 278,
      ai_duration_ms: 1300,
      ai_provider: 'openai',
      ai_model: 'gpt-oss-120b',
    };
    const html = formatDiagnosticMetadataHtml(entry);
    expect(html).toContain('history-entry-tokens');
    expect(html).toContain('328');
    expect(html).toContain('278');
    expect(html).toContain('1.3秒');
    expect(html).toContain('openai');
    expect(html).toContain('gpt-oss-120b');
  });

  it('renders content extraction byte reduction', () => {
    const entry: BrowsingLogEntry = {
      id: 1,
      url: 'https://example.com',
      created_at: Date.now(),
      page_bytes: 324740,
      candidate_bytes: 190,
    };
    const html = formatDiagnosticMetadataHtml(entry);
    expect(html).toContain('history-entry-token-reduction');
    expect(html).toContain('324740');
    expect(html).toContain('190');
    expect(html).toContain('99.9%');
  });

  it('renders Content Cleansing metrics', () => {
    const entry: BrowsingLogEntry = {
      id: 1,
      url: 'https://example.com',
      created_at: Date.now(),
      original_tokens: 48,
      cleansed_tokens: 48,
      original_bytes: 184,
      cleansed_bytes: 184,
    };
    const html = formatDiagnosticMetadataHtml(entry);
    expect(html).toContain('Content Cleansing');
    expect(html).toContain('48');
    expect(html).toContain('184');
  });

  it('renders AI Summary Cleansing metrics', () => {
    const entry: BrowsingLogEntry = {
      id: 1,
      url: 'https://example.com',
      created_at: Date.now(),
      ai_summary_original_bytes: 184,
      ai_summary_cleansed_bytes: 184,
    };
    const html = formatDiagnosticMetadataHtml(entry);
    expect(html).toContain('history-entry-ai-summary-cleansing');
    expect(html).toContain('184');
  });

  it('renders cleansing progress bar', () => {
    const entry: BrowsingLogEntry = {
      id: 1,
      url: 'https://example.com',
      created_at: Date.now(),
      page_bytes: 324740,
      candidate_bytes: 190,
      ai_summary_cleansed_bytes: 184,
    };
    const html = formatDiagnosticMetadataHtml(entry);
    expect(html).toContain('cleansing-progress-wrapper');
    expect(html).toContain('cleansing-progress-bar');
  });

  it('renders all metrics together for a fully-populated entry', () => {
    const entry: BrowsingLogEntry = {
      id: 1,
      url: 'https://example.com',
      created_at: Date.now(),
      summary: 'Test summary',
      sent_tokens: 328,
      received_tokens: 278,
      ai_duration_ms: 1300,
      ai_provider: 'openai',
      ai_model: 'gpt-oss-120b',
      page_bytes: 324740,
      candidate_bytes: 190,
      original_tokens: 48,
      cleansed_tokens: 48,
      original_bytes: 184,
      cleansed_bytes: 184,
      ai_summary_original_bytes: 184,
      ai_summary_cleansed_bytes: 184,
    };
    const html = formatDiagnosticMetadataHtml(entry);
    expect(html).toContain('history-entry-ai-summary');
    expect(html).toContain('history-entry-tokens');
    expect(html).toContain('history-entry-token-reduction');
    expect(html).toContain('history-entry-ai-summary-cleansing');
    expect(html).toContain('cleansing-progress-wrapper');
  });
});

describe('buildCleansingProgressBarHtml', () => {
  it('returns empty string when page_bytes is missing', () => {
    const entry: BrowsingLogEntry = {
      id: 1,
      url: 'https://example.com',
      created_at: Date.now(),
    };
    expect(buildCleansingProgressBarHtml(entry)).toBe('');
  });

  it('returns HTML when page_bytes and sentToAI are present', () => {
    const entry: BrowsingLogEntry = {
      id: 1,
      url: 'https://example.com',
      created_at: Date.now(),
      page_bytes: 324740,
      ai_summary_cleansed_bytes: 184,
    };
    const html = buildCleansingProgressBarHtml(entry);
    expect(html).toContain('cleansing-progress-wrapper');
    expect(html).toContain('cleansing-progress-bar');
  });
});
