/**
 * degradedSummary.test.ts
 * Table tests for the degraded-summary generator (PBI 2026-10-23-03).
 *
 * The contract: title + opening slice with the visible note, and empty/NaN/
 * negative inputs fail closed to the title-only form.
 */

import { describe, it, expect } from 'vitest';
import { degradedSummary, DEGRADED_SUMMARY_CHARS, DEGRADED_SUMMARY_NOTE } from '../degradedSummary.js';

describe('degradedSummary', () => {
  it('joins title and opening slice with the visible note', () => {
    const result = degradedSummary('Page title', 'body text here');
    expect(result).toContain('Page title');
    expect(result).toContain('body text here');
    expect(result).toContain(DEGRADED_SUMMARY_NOTE);
  });

  it('truncates the opening to the cap', () => {
    const result = degradedSummary('Title', 'x'.repeat(300));
    const head = result.split(' ― ')[1] ?? '';
    expect(head.replace(` ${DEGRADED_SUMMARY_NOTE}`, '').length).toBe(DEGRADED_SUMMARY_CHARS);
  });

  it.each([
    ['empty content falls back to title-only', 'Title', ''],
    ['undefined content falls back to title-only', 'Title', undefined as unknown as string],
    ['NaN cap falls back to the default cap', 'Title', undefined],
  ] as const)('%s', (_label, title, content) => {
    const result = degradedSummary(title, content as string);
    expect(result).toContain(title);
    expect(result).toContain(DEGRADED_SUMMARY_NOTE);
  });

  it('negative cap falls back to the default cap', () => {
    const result = degradedSummary('Title', 'y'.repeat(300), -5);
    expect(result).toContain(DEGRADED_SUMMARY_NOTE);
    expect(result.split(' ― ')[1]?.replace(` ${DEGRADED_SUMMARY_NOTE}`, '').length).toBe(DEGRADED_SUMMARY_CHARS);
  });

  it('empty title and content still produces the note', () => {
    const result = degradedSummary('', '');
    expect(result).toContain(DEGRADED_SUMMARY_NOTE);
  });

  it('trims whitespace around the title', () => {
    const result = degradedSummary('  Spaced  ', 'body');
    expect(result).toContain('Spaced');
    expect(result).not.toContain('  Spaced  ');
  });
});
