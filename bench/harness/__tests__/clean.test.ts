/**
 * clean.test.ts — bench/reports retention policy (rolling 5 + weekly anchors).
 * All expectations below use UTC ISO weeks, verified for the chosen dates.
 */
// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pruneReports, isoWeekKey } from '../clean.mjs';

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bench-clean-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function seed(extsByStamp) {
  for (const [stamp, exts] of Object.entries(extsByStamp)) {
    for (const ext of exts) writeFileSync(join(dir, `micro-${stamp}.${ext}`), 'x');
  }
}

describe('isoWeekKey', () => {
  it('returns the UTC ISO week for a stamp', () => {
    expect(isoWeekKey('2026-08-03')).toBe('2026-W32'); // Monday
    expect(isoWeekKey('2026-09-01')).toBe('2026-W36'); // Tuesday
  });
  it('returns null for a non-date stamp', () => {
    expect(isoWeekKey('latest')).toBeNull();
  });
});

describe('pruneReports (rolling 5)', () => {
  it('keeps the 5 newest generations and the newest dropped generation per week', () => {
    // W34: 08-20(Thu) 08-21(Fri) / W35: 08-24(Mon) 08-25 08-26 08-27 / W36: 09-01(Tue)
    seed({
      '2026-08-20': ['md'], '2026-08-21': ['md'], '2026-08-24': ['md'],
      '2026-08-25': ['md'], '2026-08-26': ['md'], '2026-08-27': ['md'], '2026-09-01': ['md'],
    });
    const deleted = pruneReports(dir);
    const kept = readdirSync(dir).sort();
    // rolling 5: 09-01, 08-27, 08-26, 08-25, 08-24 (weeks W35, W36 covered)
    // weekly anchor among dropped: W34 -> newest dropped 08-21
    expect(kept).toEqual([
      'micro-2026-08-21.md', 'micro-2026-08-24.md', 'micro-2026-08-25.md',
      'micro-2026-08-26.md', 'micro-2026-08-27.md', 'micro-2026-09-01.md',
    ]);
    expect(deleted).toEqual(['micro-2026-08-20.md']);
  });
});

describe('pruneReports (weekly anchors)', () => {
  it('keeps the newest generation per ISO week among dropped ones', () => {
    // W32: 08-03(Mon) 08-04(Tue) / W33: 08-10(Mon) 08-11(Tue) / W34: 08-17 08-18
    // W35: 08-24 / W36: 08-31, 09-01
    seed({
      '2026-08-03': ['md'], '2026-08-04': ['md'], '2026-08-10': ['md'], '2026-08-11': ['md'],
      '2026-08-17': ['md'], '2026-08-18': ['md'], '2026-08-24': ['md'],
      '2026-08-31': ['md'], '2026-09-01': ['md'],
    });
    const deleted = pruneReports(dir);
    const kept = readdirSync(dir).sort();
    // rolling 5: 09-01, 08-31, 08-24, 08-18, 08-17
    // anchors: W33 -> 08-11 (newest dropped in W33), W32 -> 08-04
    expect(kept).toEqual([
      'micro-2026-08-04.md', 'micro-2026-08-11.md', 'micro-2026-08-17.md',
      'micro-2026-08-18.md', 'micro-2026-08-24.md', 'micro-2026-08-31.md', 'micro-2026-09-01.md',
    ]);
    expect(deleted.sort()).toEqual(['micro-2026-08-03.md', 'micro-2026-08-10.md'].sort());
  });
});

describe('pruneReports (group deletion)', () => {
  it('deletes all files of a generation together (.md/.html/.json)', () => {
    seed({
      '2026-08-27': ['md', 'html', 'json'], '2026-08-28': ['md', 'html', 'json'],
      '2026-08-29': ['md'], '2026-08-30': ['md'], '2026-08-31': ['md'], '2026-09-01': ['md'],
    });
    pruneReports(dir);
    const kept = readdirSync(dir);
    expect(kept.some((f) => f.startsWith('micro-2026-08-27.'))).toBe(false);
    expect(kept).toContain('micro-2026-08-28.md');
    expect(kept).toContain('micro-2026-08-28.html');
    expect(kept).toContain('micro-2026-08-28.json');
  });
});

describe('pruneReports (safety)', () => {
  it('never deletes files without a date stamp', () => {
    seed({ '2026-09-01': ['md'], '2026-08-31': ['md'] });
    writeFileSync(join(dir, 'notes.md'), 'x');
    pruneReports(dir);
    expect(readdirSync(dir)).toContain('notes.md');
  });

  it('deletes everything only with --all', () => {
    seed({ '2026-09-01': ['md'], '2026-08-31': ['md'] });
    writeFileSync(join(dir, 'notes.md'), 'x');
    const deleted = pruneReports(dir, { all: true });
    expect(readdirSync(dir)).toEqual([]);
    expect(deleted.sort()).toEqual(['micro-2026-09-01.md', 'micro-2026-08-31.md', 'notes.md'].sort());
  });

  it('leaves sibling directories (baselines) untouched', () => {
    const parent = dir;
    const reports = join(parent, 'reports');
    const baselines = join(parent, 'baselines');
    mkdirSync(reports, { recursive: true });
    mkdirSync(baselines, { recursive: true });
    writeFileSync(join(baselines, 'micro.json'), '{}');
    writeFileSync(join(reports, 'micro-2026-09-01.md'), 'x');
    pruneReports(reports);
    expect(existsSync(join(baselines, 'micro.json'))).toBe(true);
  });

  it('is a no-op when the reports directory does not exist', () => {
    expect(pruneReports(join(dir, 'nope'))).toEqual([]);
  });
});
