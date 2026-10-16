import { describe, it, expect } from 'vitest';
import { planSettingsPurge } from '../queryPlanner.js';

/**
 * planSettingsPurge — settings-driven purge planning (PBI 2026-10-16-11).
 *
 * Canonical planner for the background retention-keys path: absent (null or
 * undefined) on BOTH sides means "no retention configured" -> skip, while a
 * present side is validated by the same integer rule as planPurge and `0`
 * normalizes to "skip this dimension". Unlike planPurge (wire path), an
 * absent side stays undefined — no per-side default is applied.
 */
describe('planSettingsPurge — settings-driven purge planning', () => {
  it('skips when both sides are absent (undefined / null / mixed)', () => {
    expect(planSettingsPurge({}, 'd', 'm')).toEqual({ skip: true });
    expect(planSettingsPurge({ d: null, m: undefined }, 'd', 'm')).toEqual({ skip: true });
    expect(planSettingsPurge({ d: null, m: null }, 'd', 'm')).toEqual({ skip: true });
  });

  it('passes valid numbers through and leaves the absent side undefined', () => {
    expect(planSettingsPurge({ d: 30, m: 5000 }, 'd', 'm')).toEqual({
      ok: true, retentionDays: 30, maxRecords: 5000,
    });
    expect(planSettingsPurge({ d: 60 }, 'd', 'm')).toEqual({
      ok: true, retentionDays: 60, maxRecords: undefined,
    });
  });

  it('normalizes 0 to "skip this dimension" like planPurge', () => {
    expect(planSettingsPurge({ d: 0, m: 0 }, 'd', 'm')).toEqual({
      ok: true, retentionDays: undefined, maxRecords: undefined,
    });
  });

  it('fail-closes on garbage instead of coercing (no Number() passthrough)', () => {
    for (const raw of [Number('abc'), -1, 0.5, Number.POSITIVE_INFINITY, '30', true, null]) {
      if (raw === null) continue; // null is "absent" here, covered above
      const result = planSettingsPurge({ d: raw, m: 100 }, 'd', 'm');
      expect(result).toMatchObject({ ok: false });
    }
    const result = planSettingsPurge({ d: 30, m: '1000' }, 'd', 'm');
    expect(result).toMatchObject({ ok: false });
    if (result.ok === false) expect(result.error).toContain('maxRecords');
  });

  it('reads includeStarred only when it is a boolean', () => {
    expect(planSettingsPurge({ d: 7, s: true }, 'd', 'm', 's')).toMatchObject({
      ok: true, includeStarred: true,
    });
    const omitted = planSettingsPurge({ d: 7, s: 'yes' }, 'd', 'm', 's');
    expect(omitted.ok).toBe(true);
    if (omitted.ok === true) expect('includeStarred' in omitted).toBe(false);
  });
});
