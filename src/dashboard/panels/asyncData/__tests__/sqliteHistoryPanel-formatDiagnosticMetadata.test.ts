// @vitest-environment jsdom
/**
 * sqliteHistoryPanel-formatDiagnosticMetadata.test.ts
 * VULN-001 回帰テスト: formatDiagnosticMetadataHtml() が AI プロバイダー名と
 * モデル名を HTML エスケープすることを検証する。
 *
 * VULN-001 (CWE-79, DOM XSS): ai_provider / ai_model が escapeHtml() なしに
 * innerHTML へ挿入され、`<svg onload=...>` のようなペイロードが実行可能だった。
 * 修正後は escapeHtml() を適用し、ペイロードがエスケープされることを保証する。
 */
import { describe, it, expect } from 'vitest';
import { formatDiagnosticMetadataHtml } from '../sqliteHistoryPanel.js';
import type { BrowsingLogEntry } from '../../../../utils/sqlite-types.js';

describe('formatDiagnosticMetadataHtml — AI プロバイダー/モデルの XSS エスケープ (VULN-001)', () => {
  const baseEntry: BrowsingLogEntry = {
    id: 1,
    url: 'https://example.com',
    title: 'Example',
    created_at: 1700000000000,
  };

  it('escapes ai_provider even when it contains an HTML payload', () => {
    const entry: BrowsingLogEntry = {
      ...baseEntry,
      sent_tokens: 10,
      received_tokens: 5,
      ai_provider: '<svg onload=alert(1)>',
      ai_model: 'gpt-4',
    };
    const html = formatDiagnosticMetadataHtml(entry);
    // 生のペイロードが実行可能な形で残っていないこと
    expect(html).not.toContain('<svg onload=alert(1)>');
    expect(html).toContain('&lt;svg onload=alert(1)&gt;');
    // 正常なモデル名は表示される
    expect(html).toContain('gpt-4');
  });

  it('escapes ai_model even when it contains an HTML payload', () => {
    const entry: BrowsingLogEntry = {
      ...baseEntry,
      sent_tokens: 10,
      ai_provider: 'openai',
      ai_model: '<img src=x onerror=alert(2)>',
    };
    const html = formatDiagnosticMetadataHtml(entry);
    expect(html).not.toContain('<img src=x onerror=alert(2)>');
    expect(html).toContain('&lt;img src=x onerror=alert(2)&gt;');
    expect(html).toContain('openai');
  });

  it('escapes ai_provider when only ai_provider is present without ai_model', () => {
    const entry: BrowsingLogEntry = {
      ...baseEntry,
      ai_provider: '<script>alert(3)</script>',
    };
    const html = formatDiagnosticMetadataHtml(entry);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(3)&lt;&#x2F;script&gt;');
  });

  it('renders normal values as-is without escaping', () => {
    const entry: BrowsingLogEntry = {
      ...baseEntry,
      sent_tokens: 100,
      ai_provider: 'gemini',
      ai_model: 'gemini-1.5-flash',
    };
    const html = formatDiagnosticMetadataHtml(entry);
    expect(html).toContain('gemini');
    expect(html).toContain('gemini-1.5-flash');
    expect(html).not.toContain('&amp;');
  });

  it('does not render the AI section when ai_provider / ai_model are absent', () => {
    const html = formatDiagnosticMetadataHtml({ ...baseEntry, sent_tokens: 10 });
    expect(html).not.toContain('AI:');
    expect(html).not.toContain('(AI:');
  });
});

describe('formatDiagnosticMetadataHtml — missing diagnostic reason display', () => {
  // NOTE: chrome.i18n mock resolves keys to en messages, so assertions use
  // the English wording (Content Extraction, No measurement, ...).
  const baseEntry: BrowsingLogEntry = {
    id: 1,
    url: 'https://example.com',
    title: 'Example',
    created_at: 1700000000000,
  };

  it('shows no-ai reasons for extraction and cleansing when the entry has nothing', () => {
    const html = formatDiagnosticMetadataHtml({ ...baseEntry });
    expect(html).toContain('Content Extraction');
    expect(html).toContain('Content Cleansing');
    expect(html).toContain('recorded without AI');
  });

  it('keeps a token reason row when tokens and provider are absent', () => {
    const html = formatDiagnosticMetadataHtml({ ...baseEntry });
    expect(html).toContain('history-entry-tokens');
    expect(html).toContain('recorded without AI');
  });

  it('keeps a PII reason row when masking data is absent', () => {
    const html = formatDiagnosticMetadataHtml({ ...baseEntry });
    expect(html).toContain('PII Masking');
    expect(html).toContain('recorded without AI');
  });

  it('keeps an AI summary reason row when both AI summary sides are absent', () => {
    const html = formatDiagnosticMetadataHtml({ ...baseEntry });
    expect(html).toContain('AI Summary Cleansing');
    expect(html).toContain('recorded without AI');
  });

  it('keeps the bar region with a no-ai reason when the entry has nothing', () => {
    const html = formatDiagnosticMetadataHtml({ ...baseEntry });
    expect(html).toContain('cleansing-progress-wrapper');
    expect(html).toContain('cleansing-progress-bar-missing');
    expect(html).toContain('recorded without AI');
  });

  it('keeps the bar region with an unmeasured reason for a legacy partial entry', () => {
    const html = formatDiagnosticMetadataHtml({
      ...baseEntry,
      sent_tokens: 495,
      received_tokens: 49,
      ai_provider: 'openai',
    });
    expect(html).toContain('cleansing-progress-wrapper');
    expect(html).toContain('No measurement');
    expect(html).not.toContain('recorded without AI');
  });

  it('keeps numeric bar display for a normal entry without reason rows', () => {
    const html = formatDiagnosticMetadataHtml({
      ...baseEntry,
      sent_tokens: 1483,
      page_bytes: 2300000,
      candidate_bytes: 9400,
      original_bytes: 9400,
      cleansed_bytes: 8800,
      ai_summary_original_bytes: 900,
      ai_summary_cleansed_bytes: 800,
    });
    expect(html).toContain('cleansing-progress-wrapper');
    expect(html).not.toContain('cleansing-progress-bar-missing');
    expect(html).toContain('data-bar-width=');
  });

  it('shows unmeasured reasons for a legacy partial entry with tokens but no bytes', () => {
    const html = formatDiagnosticMetadataHtml({
      ...baseEntry,
      sent_tokens: 495,
      received_tokens: 49,
      ai_provider: 'openai',
    });
    expect(html).toContain('Content Extraction');
    expect(html).toContain('No measurement');
    expect(html).not.toContain('recorded without AI');
  });

  it('shows empty reasons when page bytes are zero', () => {
    const html = formatDiagnosticMetadataHtml({
      ...baseEntry,
      page_bytes: 0,
      candidate_bytes: 0,
    });
    expect(html).toContain('Nothing to measure');
  });

  it('keeps numeric display for a normal entry without reason rows', () => {
    const html = formatDiagnosticMetadataHtml({
      ...baseEntry,
      sent_tokens: 1483,
      page_bytes: 2300000,
      candidate_bytes: 9400,
      original_bytes: 9400,
      cleansed_bytes: 8800,
      masked_count: 2,
      original_tokens: 1500,
      cleansed_tokens: 1483,
      ai_summary_original_bytes: 900,
      ai_summary_cleansed_bytes: 800,
    });
    expect(html).toContain('Bytes');
    expect(html).not.toContain('No measurement');
    expect(html).not.toContain('Nothing to measure');
  });

  it('keeps numeric display for small but positive fallback-like bytes', () => {
    const html = formatDiagnosticMetadataHtml({
      ...baseEntry,
      sent_tokens: 120,
      received_tokens: 12,
      page_bytes: 500,
      candidate_bytes: 400,
      original_bytes: 400,
      cleansed_bytes: 400,
      masked_count: 0,
      original_tokens: 100,
      cleansed_tokens: 95,
      ai_summary_original_bytes: 400,
      ai_summary_cleansed_bytes: 380,
    });
    expect(html).toContain('Bytes');
    expect(html).not.toContain('No measurement');
    expect(html).not.toContain('Nothing to measure');
  });

  it('shows an AI summary reason when only one side is present', () => {
    const html = formatDiagnosticMetadataHtml({
      ...baseEntry,
      sent_tokens: 100,
      ai_provider: 'openai',
      page_bytes: 2000,
      candidate_bytes: 1000,
      original_bytes: 1000,
      cleansed_bytes: 900,
      ai_summary_original_bytes: 900,
    });
    expect(html).toContain('AI Summary Cleansing');
    expect(html).toContain('No measurement');
  });

  it('escapes a malicious provider name inside reason rows', () => {
    const html = formatDiagnosticMetadataHtml({
      ...baseEntry,
      ai_provider: '<svg onload=alert(1)>',
    });
    expect(html).not.toContain('<svg onload=alert(1)>');
    expect(html).toContain('Content Extraction');
  });
});
