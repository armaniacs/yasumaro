import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('planAuditLog (PBI 2026-09-12-17)', () => {
  let planAuditLog: typeof import('../../offscreen/queryPlanner.js').planAuditLog;
  let AUDIT_CAP_OPFS: number;
  let AUDIT_CAP_IDB: number;

  beforeEach(async () => {
    const planner = await import('../../offscreen/queryPlanner.js');
    const limits = await import('../../messaging/limits.js');
    planAuditLog = planner.planAuditLog;
    AUDIT_CAP_OPFS = limits.AUDIT_CAP_OPFS;
    AUDIT_CAP_IDB = limits.AUDIT_CAP_IDB;
    vi.clearAllMocks();
  });

  it('selects the per-backend cap and defaults the page size', () => {
    expect(planAuditLog({}, AUDIT_CAP_OPFS)).toEqual({ limit: 100, offset: 0 });
    expect(planAuditLog(undefined, AUDIT_CAP_IDB)).toEqual({ limit: 100, offset: 0 });
  });

  it('clamps a huge limit to the backend cap', () => {
    expect(planAuditLog({ limit: 1e9 }, AUDIT_CAP_OPFS)).toEqual({ limit: AUDIT_CAP_OPFS, offset: 0 });
    expect(planAuditLog({ limit: 1e9 }, AUDIT_CAP_IDB)).toEqual({ limit: AUDIT_CAP_IDB, offset: 0 });
  });

  it('normalizes a NaN offset (Number("abc")) to 0 instead of binding NaN', () => {
    expect(planAuditLog({ offset: Number('abc') }, AUDIT_CAP_OPFS)).toEqual({ limit: 100, offset: 0 });
  });

  it('normalizes negative and fractional offsets to the JS parity value 0', () => {
    expect(planAuditLog({ offset: -5 }, AUDIT_CAP_IDB)).toEqual({ limit: 100, offset: 0 });
    expect(planAuditLog({ offset: 2.5 }, AUDIT_CAP_IDB)).toEqual({ limit: 100, offset: 0 });
  });

  it('passes a normal paging request through unchanged', () => {
    expect(planAuditLog({ limit: 500, offset: 250 }, AUDIT_CAP_OPFS)).toEqual({ limit: 500, offset: 250 });
  });
});
