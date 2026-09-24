import { describe, it, expect } from 'vitest';
import { SUMMARY_EMPTY_FALLBACK } from '../summaryFallback.js';

// Pin test: the SSOT literal is matched byte-for-byte by AI-failure detection
// (word-cluster exclusion, pipeline golden pin). Any change here must be
// intentional and must update every consumer in the same change.
describe('summaryFallback', () => {
  it('pins the AI-summary empty fallback literal', () => {
    expect(SUMMARY_EMPTY_FALLBACK).toBe('Summary not available.');
  });

  it('keeps the literal byte-length stable', () => {
    expect(SUMMARY_EMPTY_FALLBACK.length).toBe(22);
  });
});
