import { describe, it, expect } from 'vitest';
import { planPurge, DEFAULT_RETENTION_DAYS, DEFAULT_MAX_RECORDS } from '../queryPlanner.js';

describe('planPurge — destructive-op trust boundary (PBI 2026-09-12-19)', () => {
  it('passes normal values through unchanged', () => {
    expect(planPurge(90, 1000, false)).toEqual({
      ok: true, retentionDays: 90, maxRecords: 1000, includeStarred: false,
    });
  });

  it('applies defaults only for undefined', () => {
    expect(planPurge(undefined, undefined)).toEqual({
      ok: true, retentionDays: DEFAULT_RETENTION_DAYS, maxRecords: DEFAULT_MAX_RECORDS,
    });
  });

  it('fail-closes on NaN (was a silent 0-purge success)', () => {
    const result = planPurge(Number('abc'), 100);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('retentionDays');
  });

  it.each([-1, 0.5, Number.POSITIVE_INFINITY, '90', null])('fail-closes on %s for retentionDays', (raw) => {
    const result = planPurge(raw, 1000);
    expect(result.ok).toBe(false);
  });

  it.each([-1, 0.5, Number.POSITIVE_INFINITY, '1000', null])('fail-closes on %s for maxRecords', (raw) => {
    const result = planPurge(90, raw);
    expect(result.ok).toBe(false);
  });

  it('allows 0 and normalizes it to "skip this dimension" (PBI 2026-09-12-26)', () => {
    // 0 must mean the same thing for BOTH purge ops. Before the fix,
    // purgeOldRecords(0,0) deleted everything while purgeContent(0,0)
    // was a no-op (backend `>0` guards treat 0 as absent).
    const result = planPurge(0, 0);
    expect(result).toEqual({ ok: true, retentionDays: undefined, maxRecords: undefined });
  });

  it('omits includeStarred when it is not a boolean', () => {
    const result = planPurge(90, 1000, 'yes');
    expect(result.ok).toBe(true);
    if (result.ok) expect('includeStarred' in result).toBe(false);
  });
});
