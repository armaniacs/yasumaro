// @vitest-environment jsdom
/**
 * visitGating.overridesMemo.test.ts (review S3)
 * The overrides snapshot is memoized: repeated evaluations with unchanged
 * storage content do not re-run JSON.stringify, while an actual content
 * change still rebuilds the gate.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { VisitGating } from '../visitGating.js';
import { PageState } from '../pageState.js';

const BASE = 1_000_000;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('VisitGating — overrides snapshot memoization (S3)', () => {
  it('does not re-stringify while the overrides content is unchanged', () => {
    const pageState = new PageState();
    pageState.startTime = BASE;
    // Fresh object literal per read: identity alone cannot save the old
    // code — only content equality avoids the stringify.
    const gating = new VisitGating({
      getPageState: () => pageState,
      clock: () => BASE,
      isE2ETest: () => false,
      detectMediaKind: () => 'video',
      getMediaThresholdOverrides: () => ({ video: { minDuration: 60 } }),
    });
    gating.initialize();
    const stringify = vi.spyOn(JSON, 'stringify');
    try {
      for (let i = 0; i < 5; i++) {
        expect(gating.refreshCachesIfStale()).toBe(false);
      }
      expect(stringify).not.toHaveBeenCalled();
    } finally {
      stringify.mockRestore();
    }
  });

  it('still rebuilds on an actual overrides content change', () => {
    const pageState = new PageState();
    pageState.startTime = BASE;
    let overrides: Record<string, Record<string, number>> = {};
    const gating = new VisitGating({
      getPageState: () => pageState,
      clock: () => BASE,
      isE2ETest: () => false,
      detectMediaKind: () => 'video',
      getMediaThresholdOverrides: () => overrides,
    });
    gating.initialize();
    expect(gating.thresholds?.minDuration).toBe(30);
    expect(gating.refreshCachesIfStale()).toBe(false);
    overrides = { video: { minDuration: 60 } };
    expect(gating.refreshCachesIfStale()).toBe(true);
    expect(gating.thresholds?.minDuration).toBe(60);
    expect(gating.refreshCachesIfStale()).toBe(false);
  });
});
