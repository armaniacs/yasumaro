/**
 * exportReportIdsAbsorption.test.ts
 * PBI 2026-11-05-02 S-#3 — the over-long ids absorption chain.
 *
 * Pins the composition (not the units): an over-long pin list passes the
 * ExportResearchReportValidator and is truncated to MAX_QUERY_IDS by
 * normalizeReportScope, so no wire payload can widen into a giant SQL IN
 * clause. Element type stays rejected (see the C-#8 pins in
 * validators.test.ts); only length is absorbed.
 */
import { describe, it, expect } from 'vitest';
import { ExportResearchReportValidator } from '../validators.js';
import { normalizeReportScope } from '../responseCanonical.js';
import { MAX_QUERY_IDS } from '../../utils/limits.js';

describe('report ids absorption chain (S-#3)', () => {
  it('absorbs an over-long pin list: validator passes, canonical truncates', () => {
    const v = new ExportResearchReportValidator();
    const ids = Array.from({ length: MAX_QUERY_IDS + 50 }, (_, i) => i + 1);

    expect(() =>
      v.validate({ type: 'EXPORT_RESEARCH_REPORT', payload: { scope: { ids } }, protocolVersion: 1 }),
    ).not.toThrow();

    const scope = normalizeReportScope({ ids });
    expect(scope.ids).toHaveLength(MAX_QUERY_IDS);
    expect(scope.ids?.[0]).toBe(1);
    expect(scope.ids?.[MAX_QUERY_IDS - 1]).toBe(MAX_QUERY_IDS);
  });
});
