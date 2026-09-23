/**
 * timeHeatmapAggregate.ts
 * Pure weekday(7) x hour(24) aggregation for the time-heatmap panel.
 *
 * Kept separate from the panel so the bucketing is unit-testable without
 * jsdom or chrome mocks. All conversions use the browser's local time.
 */

export const TIME_HEATMAP_WEEKDAYS = 7;
export const TIME_HEATMAP_HOURS = 24;

/** Intensity bucket for cell coloring, 0 (empty) to 4 (densest). */
export type HeatmapIntensity = 0 | 1 | 2 | 3 | 4;

/** grid[weekday][hour] = record count. weekday follows Date.getDay (0 = Sunday). */
export type TimeHeatmapGrid = number[][];

export function createEmptyGrid(): TimeHeatmapGrid {
  return Array.from({ length: TIME_HEATMAP_WEEKDAYS }, () =>
    Array.from({ length: TIME_HEATMAP_HOURS }, () => 0),
  );
}

/**
 * Buckets epoch-ms timestamps into weekday x hour cells in local time.
 * Stable ordering: rows are always Sunday-first, hours ascending.
 */
export function aggregateTimeHeatmap(timestamps: readonly number[]): TimeHeatmapGrid {
  const grid = createEmptyGrid();
  for (const ts of timestamps) {
    // WHY: getDay/getHours (not getUTCDay/getUTCHours) — the PBI requires
    // local-midnight boundaries so late-night browsing lands on the right day.
    const d = new Date(ts);
    const row = grid[d.getDay()];
    if (row !== undefined) row[d.getHours()] = (row[d.getHours()] ?? 0) + 1;
  }
  return grid;
}

export function gridMax(grid: TimeHeatmapGrid): number {
  let max = 0;
  for (const row of grid) {
    for (const count of row) {
      if (count > max) max = count;
    }
  }
  return max;
}

export function gridTotal(grid: TimeHeatmapGrid): number {
  let total = 0;
  for (const row of grid) {
    for (const count of row) total += count;
  }
  return total;
}

/**
 * Maps a cell count to an intensity bucket relative to the grid maximum.
 * Quartile thresholds keep the scale stable as data grows.
 */
export function intensityLevel(count: number, max: number): HeatmapIntensity {
  if (count <= 0 || max <= 0) return 0;
  const ratio = count / max;
  if (ratio >= 0.75) return 4;
  if (ratio >= 0.5) return 3;
  if (ratio >= 0.25) return 2;
  return 1;
}
