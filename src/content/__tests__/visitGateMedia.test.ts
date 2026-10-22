/**
 * visitGateMedia.test.ts
 * Table tests for the adaptive VisitGate branching (PBI 2026-10-23-02).
 *
 * The contract: each optional metric gates only when its threshold requires
 * it, NaN/undefined inputs read as "not met", and an article page with the
 * legacy pair behaves byte-identically to the pre-adaptive gate.
 */

import { describe, it, expect } from 'vitest';
import { VisitGate } from '../visitGate.js';
import { MEDIA_KIND_DEFAULTS, mediaThresholdsFor } from '../../utils/visitThresholds.js';

describe('mediaThresholdsFor', () => {
  it('keeps the article pair byte-identical to the legacy defaults', () => {
    const t = mediaThresholdsFor('article');
    expect(t.minDuration).toBe(5);
    expect(t.minScroll).toBe(50);
  });

  it.each([
    ['video gates on watched seconds', 'video', 30],
    ['pdf gates on 15s + 2 pages', 'pdf', 15],
    ['code gates on 15s + 1 copy', 'code', 15],
  ] as const)('%s', (_label, kind, minDuration) => {
    expect(mediaThresholdsFor(kind).minDuration).toBe(minDuration);
  });

  it('resolves an unknown kind to the article pair', () => {
    expect(mediaThresholdsFor('song')).toEqual(MEDIA_KIND_DEFAULTS.article);
  });

  it('applies per-kind overrides on top of the base', () => {
    expect(mediaThresholdsFor('video', { video: { minDuration: 60 } }).minDuration).toBe(60);
  });
});

describe('VisitGate adaptive branching', () => {
  it('article needs duration + scroll, not pdf/code metrics', () => {
    const gate = new VisitGate(mediaThresholdsFor('article'));
    expect(gate.isReportable({ startTime: 0, maxScrollPercentage: 60, isValidVisitReported: false, watchedSeconds: 10 })).toBe(true);
    expect(gate.isReportable({ startTime: 0, maxScrollPercentage: 10, isValidVisitReported: false, watchedSeconds: 10 })).toBe(false);
  });

  it('video needs watched seconds, not scroll', () => {
    const gate = new VisitGate(mediaThresholdsFor('video'));
    expect(gate.isReportable({ startTime: 0, maxScrollPercentage: 0, isValidVisitReported: false, watchedSeconds: 30 })).toBe(true);
    expect(gate.isReportable({ startTime: 0, maxScrollPercentage: 0, isValidVisitReported: false, watchedSeconds: 10 })).toBe(false);
  });

  it('pdf needs pages read, not scroll', () => {
    const gate = new VisitGate(mediaThresholdsFor('pdf'));
    expect(gate.isReportable({ startTime: 0, maxScrollPercentage: 0, isValidVisitReported: false, watchedSeconds: 20, pdfPagesRead: 2 })).toBe(true);
    expect(gate.isReportable({ startTime: 0, maxScrollPercentage: 0, isValidVisitReported: false, watchedSeconds: 20, pdfPagesRead: 1 })).toBe(false);
  });

  it('code needs a copy event, not scroll', () => {
    const gate = new VisitGate(mediaThresholdsFor('code'));
    expect(gate.isReportable({ startTime: 0, maxScrollPercentage: 0, isValidVisitReported: false, watchedSeconds: 20, codeCopies: 1 })).toBe(true);
    expect(gate.isReportable({ startTime: 0, maxScrollPercentage: 0, isValidVisitReported: false, watchedSeconds: 20, codeCopies: 0 })).toBe(false);
  });

  it('reads a metric the page never produced as not met', () => {
    const gate = new VisitGate(mediaThresholdsFor('pdf'));
    expect(gate.isReportable({ startTime: 0, maxScrollPercentage: 90, isValidVisitReported: false, watchedSeconds: 20, pdfPagesRead: undefined })).toBe(false);
    expect(gate.isReportable({ startTime: 0, maxScrollPercentage: 90, isValidVisitReported: false, watchedSeconds: 20, pdfPagesRead: Number.NaN })).toBe(false);
  });

  it('keeps the reported-once guard', () => {
    const gate = new VisitGate(mediaThresholdsFor('article'));
    expect(gate.isReportable({ startTime: 0, maxScrollPercentage: 90, isValidVisitReported: true, watchedSeconds: 10 })).toBe(false);
  });

  it('clamps negative elapsed to zero for legacy states', () => {
    const gate = new VisitGate(mediaThresholdsFor('article'), () => 1000);
    expect(gate.isReportable({ startTime: 5000, maxScrollPercentage: 90, isValidVisitReported: false })).toBe(false);
  });
});
