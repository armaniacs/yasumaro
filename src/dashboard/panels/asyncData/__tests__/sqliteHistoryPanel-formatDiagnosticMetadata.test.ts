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
import type { BrowsingLogEntry } from '../../../utils/sqlite-types.js';

describe('formatDiagnosticMetadataHtml — AI プロバイダー/モデルの XSS エスケープ (VULN-001)', () => {
  const baseEntry: BrowsingLogEntry = {
    id: 1,
    url: 'https://example.com',
    title: 'Example',
    created_at: 1700000000000,
  };

  it('ai_provider に HTML ペイロードが含まれてもエスケープされる', () => {
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

  it('ai_model に HTML ペイロードが含まれてもエスケープされる', () => {
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

  it('ai_provider のみで ai_model がない場合も ai_provider はエスケープされる', () => {
    const entry: BrowsingLogEntry = {
      ...baseEntry,
      ai_provider: '<script>alert(3)</script>',
    };
    const html = formatDiagnosticMetadataHtml(entry);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(3)&lt;/script&gt;');
  });

  it('エスケープされない正常値はそのまま表示される', () => {
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

  it('ai_provider / ai_model がない場合は AI セクションを生成しない', () => {
    const html = formatDiagnosticMetadataHtml({ ...baseEntry, sent_tokens: 10 });
    expect(html).not.toContain('AI:');
    expect(html).not.toContain('(AI:');
  });
});
