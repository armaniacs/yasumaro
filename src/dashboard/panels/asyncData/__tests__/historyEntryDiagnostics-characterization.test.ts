// @vitest-environment jsdom
/**
 * historyEntryDiagnostics-characterization.test.ts (PBI 2026-09-23-01)
 *
 * Characterization test: pins the byte-exact HTML output of the diagnostics
 * builders across a fixture set covering every diagnostic branch
 * (extraction / cleansing / tokens / masking / aiSummary missing & normal
 * patterns, fallback reasons, XSS escaping).
 *
 * Snapshots were written BEFORE the deep-module move (against the View's
 * `formatDiagnosticMetadataHtml` / `buildCleansingProgressBarHtml`). After
 * the move they run against the module's `renderEntryDiagnostics` /
 * `renderCleansingBar` — unchanged snapshots passing proves byte-identical
 * output. The `toBe` assertions additionally pin the View adapters to the
 * module output on every run.
 *
 * NOTE: the describe/it names are frozen — renaming them orphans the pinned
 * snapshots and silently voids this gate.
 */
import { describe, it, expect } from 'vitest';
import {
  formatDiagnosticMetadataHtml,
  buildCleansingProgressBarHtml,
} from '../sqliteHistoryPanelView.js';
import {
  MISSING_REASON_KEYS,
  renderCleansingBar,
  renderEntryDiagnostics,
} from '../historyEntryPresentation.js';
import type { BrowsingLogEntry } from '../../../../utils/sqlite-types.js';

function base(overrides: Partial<BrowsingLogEntry> = {}): BrowsingLogEntry {
  return {
    id: 1,
    url: 'https://example.com',
    title: 'Example',
    created_at: 1700000000000,
    ...overrides,
  };
}

/**
 * Fixture set — one entry per diagnostic branch combination. Keys are
 * stable snapshot names; adding a branch means adding a fixture here.
 */
const FIXTURES: Record<string, BrowsingLogEntry> = {
  // All rows numeric, no reason rows, numeric bar.
  'normal-full': base({
    summary: 'AI summary text',
    sent_tokens: 1483,
    received_tokens: 49,
    ai_provider: 'openai',
    ai_model: 'gpt-4o-mini',
    ai_duration_ms: 1200,
    page_bytes: 2300000,
    candidate_bytes: 9400,
    original_bytes: 9400,
    cleansed_bytes: 8800,
    masked_count: 2,
    original_tokens: 1500,
    cleansed_tokens: 1483,
    ai_summary_original_bytes: 900,
    ai_summary_cleansed_bytes: 800,
  }),
  // Nothing measured — every row keeps a no-ai reason, missing bar.
  'empty-no-ai': base({}),
  // Zero-byte page — empty reasons on the byte rows.
  'zero-bytes': base({ page_bytes: 0, candidate_bytes: 0 }),
  // Legacy partial: tokens + provider, no bytes — unmeasured reasons.
  'legacy-partial-unmeasured': base({
    sent_tokens: 495,
    received_tokens: 49,
    ai_provider: 'openai',
  }),
  // Provider-only token row with model + duration.
  'tokens-provider-only': base({
    ai_provider: 'gemini',
    ai_model: 'gemini-1.5-flash',
    ai_duration_ms: 2500,
  }),
  // Sent-tokens-only numeric row, no provider line.
  'tokens-sent-only': base({ sent_tokens: 100 }),
  // Cleansing bytes resolved via candidate_bytes fallback.
  'cleansing-candidate-fallback': base({
    sent_tokens: 100,
    ai_provider: 'openai',
    page_bytes: 2000,
    candidate_bytes: 500,
    cleansed_bytes: 400,
    ai_summary_original_bytes: 400,
    ai_summary_cleansed_bytes: 380,
  }),
  // Masking row from masked_count: 0 alone (0 is present, not missing).
  'masking-count-zero': base({
    sent_tokens: 120,
    received_tokens: 12,
    page_bytes: 500,
    candidate_bytes: 400,
    original_bytes: 400,
    cleansed_bytes: 400,
    masked_count: 0,
    ai_summary_original_bytes: 400,
    ai_summary_cleansed_bytes: 380,
  }),
  // Masking row from token pair alone.
  'masking-tokens-only': base({
    page_bytes: 500,
    candidate_bytes: 400,
    original_bytes: 400,
    cleansed_bytes: 400,
    original_tokens: 100,
    cleansed_tokens: 95,
    ai_summary_original_bytes: 400,
    ai_summary_cleansed_bytes: 380,
  }),
  // AI summary single-side present — reason row with ': ' separator.
  'ai-summary-single-side': base({
    sent_tokens: 100,
    ai_provider: 'openai',
    page_bytes: 2000,
    candidate_bytes: 1000,
    original_bytes: 1000,
    cleansed_bytes: 900,
    ai_summary_original_bytes: 900,
  }),
  // AI summary both sides zero — empty reason.
  'ai-summary-zero': base({
    ai_summary_original_bytes: 0,
    ai_summary_cleansed_bytes: 0,
  }),
  // Known fallback reason appends a row.
  'fallback-known': base({
    sent_tokens: 100,
    ai_provider: 'openai',
    page_bytes: 2000,
    candidate_bytes: 1000,
    original_bytes: 1000,
    ai_summary_original_bytes: 900,
    ai_summary_cleansed_bytes: 800,
    fallback_triggered: 1,
    fallback_reason: 'short_content',
    cleansed_bytes: 300,
  }),
  // Unknown fallback reason is omitted (no row, never a broken key).
  'fallback-unknown': base({
    sent_tokens: 100,
    ai_provider: 'openai',
    page_bytes: 2000,
    candidate_bytes: 1000,
    original_bytes: 1000,
    cleansed_bytes: 900,
    ai_summary_original_bytes: 900,
    ai_summary_cleansed_bytes: 800,
    fallback_triggered: 1,
    fallback_reason: 'mystery_reason',
  }),
  // Malicious provider name is escaped everywhere.
  'xss-provider': base({
    sent_tokens: 10,
    received_tokens: 5,
    ai_provider: '<svg onload=alert(1)>',
    ai_model: 'gpt-4',
  }),
  // Blank summary renders no summary row.
  'blank-summary': base({
    summary: '   ',
    sent_tokens: 10,
    ai_provider: 'openai',
  }),
};

describe('historyEntryDiagnostics characterization (pre-move pin)', () => {
  for (const [name, entry] of Object.entries(FIXTURES)) {
    it(`formatDiagnosticMetadataHtml — ${name}`, () => {
      const fromModule = renderEntryDiagnostics(entry);
      // Adapter contract: the View one-liner delegates without alteration.
      expect(fromModule).toBe(formatDiagnosticMetadataHtml(entry));
      // Byte-equality gate: must match the pre-move pinned snapshot.
      expect(fromModule).toMatchSnapshot();
    });
    it(`buildCleansingProgressBarHtml — ${name}`, () => {
      const fromModule = renderCleansingBar(entry);
      expect(fromModule).toBe(buildCleansingProgressBarHtml(entry));
      expect(fromModule).toMatchSnapshot();
    });
  }

  it('exposes the missing-reason key table as the single owner', () => {
    expect(MISSING_REASON_KEYS).toEqual({
      'no-ai': 'historyMissingReasonNoAi',
      empty: 'historyMissingReasonEmpty',
      unmeasured: 'historyMissingReasonUnmeasured',
    });
  });
});
