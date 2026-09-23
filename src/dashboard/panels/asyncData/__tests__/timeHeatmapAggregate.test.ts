// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  aggregateTimeHeatmap,
  createEmptyGrid,
  gridMax,
  gridTotal,
  intensityLevel,
  TIME_HEATMAP_HOURS,
  TIME_HEATMAP_WEEKDAYS,
} from '../../../timeHeatmapAggregate.js';

/** Local-time epoch ms — immune to the runner's TZ. */
function localTs(year: number, month1: number, day: number, hour: number, minute = 0): number {
  return new Date(year, month1 - 1, day, hour, minute).getTime();
}

describe('timeHeatmapAggregate', () => {
  it('creates a 7x24 zero grid', () => {
    const grid = createEmptyGrid();
    expect(grid).toHaveLength(TIME_HEATMAP_WEEKDAYS);
    for (const row of grid) {
      expect(row).toHaveLength(TIME_HEATMAP_HOURS);
      expect(row!.every((c) => c === 0)).toBe(true);
    }
  });

  it('maps timestamps to local weekday/hour cells', () => {
    // 2026-09-21 is a Monday.
    const grid = aggregateTimeHeatmap([
      localTs(2026, 9, 21, 9),
      localTs(2026, 9, 21, 9, 30),
      localTs(2026, 9, 22, 23),
    ]);
    const monday = new Date(2026, 8, 21).getDay();
    const tuesday = new Date(2026, 8, 22).getDay();
    expect(grid[monday]?.[9]).toBe(2);
    expect(grid[tuesday]?.[23]).toBe(1);
    expect(gridTotal(grid)).toBe(3);
  });

  it('buckets records across local midnight without date drift', () => {
    const before = localTs(2026, 9, 21, 23, 59);
    const after = localTs(2026, 9, 22, 0, 1);
    const grid = aggregateTimeHeatmap([before, after]);
    const dayBefore = new Date(before).getDay();
    const dayAfter = new Date(after).getDay();
    expect(grid[dayBefore]?.[23]).toBe(1);
    expect(grid[dayAfter]?.[0]).toBe(1);
  });

  it('returns an empty grid for empty input', () => {
    const grid = aggregateTimeHeatmap([]);
    expect(gridTotal(grid)).toBe(0);
    expect(gridMax(grid)).toBe(0);
  });

  it('keeps stable ordering for identical inputs', () => {
    const input = [localTs(2026, 9, 21, 9), localTs(2026, 9, 23, 14)];
    expect(aggregateTimeHeatmap(input)).toEqual(aggregateTimeHeatmap(input));
  });

  it('aggregates large inputs without loss', () => {
    const ts = localTs(2026, 9, 21, 12);
    const grid = aggregateTimeHeatmap(Array.from({ length: 10000 }, () => ts));
    expect(gridTotal(grid)).toBe(10000);
    expect(gridMax(grid)).toBe(10000);
  });

  it('maps counts to intensity quartiles', () => {
    expect(intensityLevel(0, 100)).toBe(0);
    expect(intensityLevel(0, 0)).toBe(0);
    expect(intensityLevel(10, 100)).toBe(1);
    expect(intensityLevel(25, 100)).toBe(2);
    expect(intensityLevel(50, 100)).toBe(3);
    expect(intensityLevel(75, 100)).toBe(4);
    expect(intensityLevel(100, 100)).toBe(4);
  });
});
