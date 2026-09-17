import { describe, it, expect } from 'vitest';
import {
  classifyAiSummaryMissing,
  classifyCleansingMissing,
  classifyDiagnosticMissing,
  classifyExtractionMissing,
  resolveCleansingBytes,
} from '../historyEntryPresentation.js';
import type { BrowsingLogEntry } from '../../../../utils/sqlite-types.js';

function makeEntry(overrides: Partial<BrowsingLogEntry> = {}): BrowsingLogEntry {
  return {
    id: 1,
    url: 'https://example.com',
    title: 'Example',
    created_at: 1700000000000,
    ...overrides,
  };
}

describe('historyEntryPresentation', () => {
  describe('classifyDiagnosticMissing', () => {
    it('returns empty when any byte field is zero', () => {
      expect(classifyDiagnosticMissing(makeEntry({ page_bytes: 0 }))).toBe('empty');
      expect(classifyDiagnosticMissing(makeEntry({ ai_summary_original_bytes: 0 }))).toBe('empty');
    });

    it('returns no-ai when tokens and provider are absent', () => {
      expect(classifyDiagnosticMissing(makeEntry({}))).toBe('no-ai');
    });

    it('returns unmeasured for a legacy partial entry with tokens but no bytes', () => {
      const entry = makeEntry({ sent_tokens: 495, received_tokens: 49, ai_provider: 'openai' });
      expect(classifyDiagnosticMissing(entry)).toBe('unmeasured');
    });

    it('prefers empty over no-ai when both conditions hold', () => {
      expect(classifyDiagnosticMissing(makeEntry({ page_bytes: 0 }))).toBe('empty');
    });
  });

  describe('classifyExtractionMissing', () => {
    it('returns null when bytes are present and positive', () => {
      const entry = makeEntry({ page_bytes: 2000, candidate_bytes: 1000 });
      expect(classifyExtractionMissing(entry)).toBeNull();
    });

    it('returns empty when page_bytes is zero', () => {
      const entry = makeEntry({ page_bytes: 0, candidate_bytes: 0 });
      expect(classifyExtractionMissing(entry)).toBe('empty');
    });

    it('returns no-ai when bytes and AI info are absent', () => {
      expect(classifyExtractionMissing(makeEntry({}))).toBe('no-ai');
    });

    it('returns unmeasured for a legacy partial entry', () => {
      const entry = makeEntry({ sent_tokens: 495, ai_provider: 'openai' });
      expect(classifyExtractionMissing(entry)).toBe('unmeasured');
    });
  });

  describe('classifyCleansingMissing', () => {
    it('returns null when original bytes are positive', () => {
      expect(classifyCleansingMissing(makeEntry({ original_bytes: 2000, cleansed_bytes: 1800 }))).toBeNull();
    });

    it('resolves the original via candidate_bytes fallback', () => {
      expect(classifyCleansingMissing(makeEntry({ candidate_bytes: 500, cleansed_bytes: 400 }))).toBeNull();
    });

    it('returns empty when original_bytes is zero', () => {
      expect(classifyCleansingMissing(makeEntry({ original_bytes: 0 }))).toBe('empty');
    });

    it('returns unmeasured when both bytes are absent but tokens exist', () => {
      const entry = makeEntry({ sent_tokens: 495, ai_provider: 'openai' });
      expect(classifyCleansingMissing(entry)).toBe('unmeasured');
    });

    it('returns no-ai when everything is absent', () => {
      expect(classifyCleansingMissing(makeEntry({}))).toBe('no-ai');
    });
  });

  describe('classifyAiSummaryMissing', () => {
    it('returns null when both sides are present and positive', () => {
      const entry = makeEntry({ ai_summary_original_bytes: 900, ai_summary_cleansed_bytes: 800 });
      expect(classifyAiSummaryMissing(entry)).toBeNull();
    });

    it('returns empty when the original side is zero', () => {
      const entry = makeEntry({ ai_summary_original_bytes: 0, ai_summary_cleansed_bytes: 0 });
      expect(classifyAiSummaryMissing(entry)).toBe('empty');
    });

    it('returns unmeasured for single-side data with tokens present', () => {
      const entry = makeEntry({ ai_summary_original_bytes: 900, sent_tokens: 100, ai_provider: 'openai' });
      expect(classifyAiSummaryMissing(entry)).toBe('unmeasured');
    });

    it('returns no-ai for single-side data without AI info', () => {
      const entry = makeEntry({ ai_summary_original_bytes: 900 });
      expect(classifyAiSummaryMissing(entry)).toBe('no-ai');
    });
  });

  describe('resolveCleansingBytes', () => {
    it('prefers original_bytes over candidate_bytes', () => {
      const resolved = resolveCleansingBytes(makeEntry({ original_bytes: 2000, candidate_bytes: 500, cleansed_bytes: 1800 }));
      expect(resolved.original).toBe(2000);
      expect(resolved.cleansed).toBe(1800);
    });

    it('falls back to candidate_bytes when original_bytes is missing', () => {
      const resolved = resolveCleansingBytes(makeEntry({ candidate_bytes: 500, cleansed_bytes: 400 }));
      expect(resolved.original).toBe(500);
      expect(resolved.cleansed).toBe(400);
    });

    it('honors a legitimate zero instead of falling through', () => {
      const resolved = resolveCleansingBytes(makeEntry({ original_bytes: 0, candidate_bytes: 500 }));
      expect(resolved.original).toBe(0);
    });

    it('returns undefined sides when all sources are missing', () => {
      const resolved = resolveCleansingBytes(makeEntry({}));
      expect(resolved.original).toBeUndefined();
      expect(resolved.cleansed).toBeUndefined();
    });
  });
});
