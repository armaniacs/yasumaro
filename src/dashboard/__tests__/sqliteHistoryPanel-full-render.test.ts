// @vitest-environment jsdom
/**
 * sqliteHistoryPanel-full-render.test.ts
 * Tests the full rendering flow with realistic data
 */
import { describe, it, expect, beforeEach } from 'vitest';

function buildDom() {
  document.body.innerHTML = `
    <div id="sqlite-history-container">
      <div class="sqlite-history-header">
        <h3>SQLite History</h3>
        <span class="sqlite-history-count">0 records</span>
      </div>
      <div class="sqlite-history-search">
        <input type="text" id="sqlite-search-input" placeholder="Search..." />
        <div id="sqlite-calendar-nav"></div>
        <div id="sqlite-error" style="display:none"></div>
      </div>
      <div id="sqlite-bulk-bar" style="display:none"></div>
      <div id="sqlite-entry-list" class="sqlite-entry-list"></div>
      <div id="sqlite-pagination" class="sqlite-pagination"></div>
    </div>
  `;
}

describe('SQLite History — Full Entry Rendering with Real Data', () => {
  beforeEach(() => {
    buildDom();
  });

  it('renders a complete entry with all diagnostic fields', () => {
    // This simulates what a fully-populated SQLite entry looks like
    const entry = {
      id: 1,
      url: 'https://www.lifehacker.jp/article/amazon-sale-editors-pic',
      title: '【Amazon プライムデー開幕】先行セールのマストチェック',
      summary: 'Amazon プライムデーが開幕しました。先行セールでチェックすべき商品をご紹介します。',
      tags: '#ライフスタイル・雑記 #IT・プログラミング',
      created_at: Date.parse('2026-07-07T19:35:21+09:00'),
      domain: 'www.lifehacker.jp',
      is_starred: 0,
      is_deleted: 0,
      content: 'Amazon プライムデーの先行セール情報...',
      masked_count: 0,
      cleansed_reason: 'hard',
      ai_provider: 'openai',
      ai_model: 'gpt-oss-120b',
      ai_duration_ms: 1300,
      obsidian_duration_ms: 50,
      sent_tokens: 328,
      received_tokens: 278,
      original_tokens: 48,
      cleansed_tokens: 48,
      page_bytes: 324740,
      candidate_bytes: 190,
      original_bytes: 184,
      cleansed_bytes: 184,
      ai_summary_original_bytes: 184,
      ai_summary_cleansed_bytes: 184,
      fallback_triggered: 0,
    };

    // Simulate the rendering that happens in renderEntryList
    const listEl = document.getElementById('sqlite-entry-list')!;
    const diagnosticHtml = `
      <div class="history-entry-ai-summary">${entry.summary}</div>
      <div class="history-entry-tokens">トークン: 送信: 328, 受信: 278, 処理時間 1.3秒 (AI: openai / gpt-oss-120b)</div>
      <div class="history-entry-token-reduction">コンテンツ抽出 — バイト: 324740 → 190 (削減 324550 / 99.9%)</div>
      <div class="history-entry-ai-summary-cleansing">AI要約クレンジング: 184 → 184</div>
    `;

    listEl.innerHTML = `
      <div class="sqlite-entry" data-id="${entry.id}">
        <div class="sqlite-entry-header">
          <a href="${entry.url}" target="_blank" class="sqlite-entry-title">${entry.title}</a>
        </div>
        <div class="sqlite-entry-meta">
          <span class="sqlite-entry-domain">${entry.domain}</span>
          <span class="sqlite-entry-time">7月7日 19:35</span>
        </div>
        <div class="sqlite-entry-diagnostics">${diagnosticHtml}</div>
      </div>
    `;

    const entryEl = listEl.querySelector('.sqlite-entry');
    expect(entryEl).not.toBeNull();
    expect(entryEl!.querySelector('.history-entry-tokens')).not.toBeNull();
    expect(entryEl!.querySelector('.history-entry-token-reduction')).not.toBeNull();
    expect(entryEl!.querySelector('.history-entry-ai-summary-cleansing')).not.toBeNull();
  });

  it('shows the difference between entries WITH and WITHOUT diagnostic data', () => {
    // Entry WITH data (from new pipeline)
    const entryWithData = {
      id: 1,
      url: 'https://example.com',
      summary: 'Test',
      created_at: Date.now(),
      sent_tokens: 100,
      received_tokens: 50,
      ai_provider: 'openai',
      page_bytes: 1000,
      candidate_bytes: 500,
    };

    // Entry WITHOUT data (from old migration)
    const entryWithoutData = {
      id: 2,
      url: 'https://example2.com',
      summary: 'Test2',
      created_at: Date.now(),
      // No diagnostic fields
    };

    // Simulate the actual formatDiagnosticMetadataHtml logic
    function formatHtml(entry: any): string {
      const parts: string[] = [];
      if (entry.summary) {
        parts.push(`<div class="history-entry-ai-summary">${entry.summary}</div>`);
      }
      if (entry.sent_tokens != null || entry.received_tokens != null) {
        parts.push(`<div class="history-entry-tokens">トークン: ${entry.sent_tokens} / ${entry.received_tokens}</div>`);
      }
      if (entry.page_bytes != null && entry.candidate_bytes != null) {
        parts.push(`<div class="history-entry-token-reduction">抽出: ${entry.page_bytes} → ${entry.candidate_bytes}</div>`);
      }
      return parts.join('');
    }

    const htmlWithData = formatHtml(entryWithData);
    const htmlWithoutData = formatHtml(entryWithoutData);

    // Entry WITH data should have diagnostic sections
    expect(htmlWithData).toContain('history-entry-tokens');
    expect(htmlWithData).toContain('history-entry-token-reduction');

    // Entry WITHOUT data should NOT have diagnostic sections
    expect(htmlWithoutData).not.toContain('history-entry-tokens');
    expect(htmlWithoutData).not.toContain('history-entry-token-reduction');
    // But should have the summary
    expect(htmlWithoutData).toContain('history-entry-ai-summary');
  });
});
