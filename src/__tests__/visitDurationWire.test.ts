/**
 * visitDurationWire.test.ts
 * Pin for the visit_duration NULL resolution (PBI 2026-10-23-02).
 *
 * The saved row carried hardcoded NULL for visit_duration/scroll_ratio, so
 * automatically recorded visits never showed how long the page was read. The
 * wire contract now rides the metrics from the content script, and the mapper
 * maps them into the row.
 */

import { describe, it, expect } from 'vitest';
import { toValidVisitPayload } from '../content/visitPayload.js';
import type { PageState } from '../content/pageState.js';

function makeState(): PageState {
  const state = new (class {})() as unknown as PageState;
  return Object.assign(state, {
    startTime: Date.now() - 10_000,
    maxScrollPercentage: 72,
    isValidVisitReported: false,
    minVisitDuration: 5,
    minScrollDepth: 50,
    lastByteStats: {},
    lastAiSummaryCleansedStats: {},
    lastCleansedReason: 'none',
    lastCleanseStats: {},
  }) as PageState;
}

describe('visit_duration wire contract', () => {
  it('rides the metrics into the VALID_VISIT payload', () => {
    const payload = toValidVisitPayload(makeState(), 'body', {
      metrics: { visitDurationSeconds: 10.5, scrollRatioPercent: 72 },
    });
    expect(payload.visitDurationSeconds).toBe(10.5);
    expect(payload.scrollRatioPercent).toBe(72);
  });

  it('omits the metrics keys when the caller has none (manual record)', () => {
    const payload = toValidVisitPayload(makeState(), 'body');
    expect('visitDurationSeconds' in payload).toBe(false);
    expect('scrollRatioPercent' in payload).toBe(false);
  });

  it('keeps the metrics through a force re-send', () => {
    const payload = toValidVisitPayload(makeState(), 'body', {
      force: true,
      metrics: { visitDurationSeconds: 3, scrollRatioPercent: 12 },
    });
    expect(payload.force).toBe(true);
    expect(payload.visitDurationSeconds).toBe(3);
    expect(payload.scrollRatioPercent).toBe(12);
  });
});
