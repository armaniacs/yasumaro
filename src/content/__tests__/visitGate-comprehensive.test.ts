// @vitest-environment jsdom
/**
 * visitGate-comprehensive.test.ts
 * 8パターン + clock注入 + PageState 連携 + NTP補正 clamp をカバーし visitGate 90%+ を達成
 */
import { describe, it, expect, vi } from 'vitest';
import { VisitGate, type VisitGateThresholds, type VisitState } from '../visitGate.js';
import { PageState } from '../pageState.js';
import { createVisitGate, shouldRecordVisit, getPageStateForTesting } from '../extractor.js';

describe('VisitGate.shouldRecord - 4象限 + 閾値バリエーション', () => {
  const base: VisitGateThresholds = { minDuration: 5, minScroll: 50 };

  it('both met exactly at threshold => true', () => {
    const g = new VisitGate(base);
    expect(g.shouldRecord(5, 50)).toBe(true);
  });
  it('duration above, scroll above => true', () => {
    const g = new VisitGate(base);
    expect(g.shouldRecord(10, 100)).toBe(true);
  });
  it('duration below, scroll above => false', () => {
    const g = new VisitGate(base);
    expect(g.shouldRecord(4, 70)).toBe(false);
    expect(g.shouldRecord(0, 100)).toBe(false);
    expect(g.shouldRecord(4.99, 50)).toBe(false);
  });
  it('duration above, scroll below => false', () => {
    const g = new VisitGate(base);
    expect(g.shouldRecord(10, 30)).toBe(false);
    expect(g.shouldRecord(5, 49.99)).toBe(false);
  });
  it('both below => false', () => {
    const g = new VisitGate(base);
    expect(g.shouldRecord(2, 20)).toBe(false);
  });
  it('custom threshold 2s/5% - honors injected thresholds', () => {
    const g = new VisitGate({ minDuration: 2, minScroll: 5 });
    expect(g.shouldRecord(3, 10)).toBe(true);
    expect(g.shouldRecord(1, 10)).toBe(false);
    expect(g.shouldRecord(3, 4)).toBe(false);
  });
  it('negative values => false', () => {
    const g = new VisitGate(base);
    expect(g.shouldRecord(-1, 50)).toBe(false);
    expect(g.shouldRecord(10, -1)).toBe(false);
  });
  it('zero thresholds => always true when thresholds are 0', () => {
    const g = new VisitGate({ minDuration: 0, minScroll: 0 });
    expect(g.shouldRecord(0, 0)).toBe(true);
  });
});

describe('VisitGate.isReportable - clock注入 8パターン', () => {
  const thresholds: VisitGateThresholds = { minDuration: 5, minScroll: 50 };
  const baseStart = 1_000_000;

  function state(over: Partial<VisitState> = {}): VisitState {
    return { startTime: baseStart, maxScrollPercentage: 0, isValidVisitReported: false, ...over };
  }

  it('elapsed ok + scroll ok + not reported => true', () => {
    const clock = () => baseStart + 6000;
    const g = new VisitGate(thresholds, clock);
    expect(g.isReportable(state({ maxScrollPercentage: 60 }))).toBe(true);
  });

  it('elapsed below threshold => false', () => {
    const clock = () => baseStart + 4000;
    const g = new VisitGate(thresholds, clock);
    expect(g.isReportable(state({ maxScrollPercentage: 80 }))).toBe(false);
  });

  it('scroll below threshold => false', () => {
    const clock = () => baseStart + 6000;
    const g = new VisitGate(thresholds, clock);
    expect(g.isReportable(state({ maxScrollPercentage: 30 }))).toBe(false);
    expect(g.isReportable(state({ maxScrollPercentage: 49.99 }))).toBe(false);
  });

  it('both below => false', () => {
    const clock = () => baseStart + 2000;
    const g = new VisitGate(thresholds, clock);
    expect(g.isReportable(state({ maxScrollPercentage: 10 }))).toBe(false);
  });

  it('already reported => false regardless of thresholds', () => {
    const clock = () => baseStart + 10000;
    const g = new VisitGate(thresholds, clock);
    expect(g.isReportable(state({ maxScrollPercentage: 100, isValidVisitReported: true }))).toBe(false);
  });

  it('exact threshold boundary => true', () => {
    const clock = () => baseStart + 5000;
    const g = new VisitGate(thresholds, clock);
    expect(g.isReportable(state({ maxScrollPercentage: 50 }))).toBe(true);
  });

  it('just below boundary => false', () => {
    const clock = () => baseStart + 4999;
    const g = new VisitGate(thresholds, clock);
    expect(g.isReportable(state({ maxScrollPercentage: 50 }))).toBe(false);
    const clock2 = () => baseStart + 5000;
    const g2 = new VisitGate(thresholds, clock2);
    expect(g2.isReportable(state({ maxScrollPercentage: 49.99 }))).toBe(false);
  });

  it('negative elapsed (NTP skew) is clamped to 0 => false', () => {
    const clock = () => baseStart - 5000; // skew back
    const g = new VisitGate(thresholds, clock);
    expect(g.isReportable(state({ maxScrollPercentage: 100 }))).toBe(false);
    // clamp check: elapsed = max(0, (clock - start)/1000) =0, so even with long ago startTime still false
  });

  it('clock injection is used (vi.fn verifies call)', () => {
    const clock = vi.fn(() => baseStart + 7000);
    const g = new VisitGate(thresholds, clock);
    g.isReportable(state({ maxScrollPercentage: 60 }));
    expect(clock).toHaveBeenCalledTimes(1);
  });

  it('default clock uses Date.now (no injection) - smoke', () => {
    const now = Date.now();
    const g = new VisitGate({ minDuration: 0, minScroll: 0 });
    // startTime far in past, should be reportable with default clock
    expect(g.isReportable({ startTime: now - 10000, maxScrollPercentage: 100, isValidVisitReported: false })).toBe(true);
  });
});

describe('PageState ↔ VisitGate 連携', () => {
  it('toVisitGateThresholds returns current min values', () => {
    const ps = new PageState();
    ps.minVisitDuration = 7;
    ps.minScrollDepth = 77;
    expect(ps.toVisitGateThresholds()).toEqual({ minDuration: 7, minScroll: 77 });
  });
  it('toVisitState returns snapshot', () => {
    const ps = new PageState();
    ps.startTime = 12345;
    ps.maxScrollPercentage = 88;
    ps.isValidVisitReported = true;
    expect(ps.toVisitState()).toEqual({ startTime: 12345, maxScrollPercentage: 88, isValidVisitReported: true });
  });
  it('createVisitGate factory binds to pageState thresholds and allows clock injection', () => {
    const ps = getPageStateForTesting() as unknown as PageState;
    const prevDur = ps.minVisitDuration;
    const prevScroll = ps.minScrollDepth;
    ps.minVisitDuration = 3;
    ps.minScrollDepth = 10;
    const fakeNow = 2_000_000;
    const clock = () => fakeNow + 5000;
    const gate = createVisitGate(clock);
    // gate should use thresholds 3/10
    expect(gate.shouldRecord(3, 10)).toBe(true);
    expect(gate.shouldRecord(2, 10)).toBe(false);
    // restore
    ps.minVisitDuration = prevDur;
    ps.minScrollDepth = prevScroll;
  });
  it('shouldRecordVisit wrapper delegates to VisitGate and respects explicit thresholds', () => {
    expect(shouldRecordVisit(3, 10, 2, 5)).toBe(true);
    expect(shouldRecordVisit(3, 10, 5, 5)).toBe(false);
  });
});
