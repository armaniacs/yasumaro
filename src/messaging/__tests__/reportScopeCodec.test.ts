/**
 * reportScopeCodec.test.ts
 * PBI 2026-11-08-07 — report scope twin traversal is one codec.
 *
 * Field-addition pin: every case below is driven by the canonical tables
 * themselves, so adding a field to REPORT_SCOPE_*_FIELDS automatically
 * extends coverage to it. For each listed field a bad value must be
 * rejected by ExportResearchReportValidator (policy 'reject') and absorbed
 * by normalizeReportScope (policy 'absorb'). Both gates walk the single
 * traversal forEachReportScopeField - never their own loop.
 */
import { describe, it, expect } from 'vitest';
import { ExportResearchReportValidator, ValidationError } from '../validators.js';
import {
  forEachReportScopeField,
  normalizeReportScope,
  REPORT_SCOPE_ARRAY_FIELDS,
  REPORT_SCOPE_NUMBER_FIELDS,
  REPORT_SCOPE_STRING_FIELDS,
} from '../responseCanonical.js';

const ALL_TABLE_FIELDS: string[] = [
  ...REPORT_SCOPE_STRING_FIELDS,
  ...REPORT_SCOPE_NUMBER_FIELDS,
  ...REPORT_SCOPE_ARRAY_FIELDS,
];

function validateScope(scope: Record<string, unknown>): void {
  new ExportResearchReportValidator().validate({
    type: 'EXPORT_RESEARCH_REPORT',
    payload: { scope },
    protocolVersion: 1,
  });
}

describe('reportScopeCodec', () => {
  describe('forEachReportScopeField', () => {
    it('visits exactly the canonical table union once per field', () => {
      for (const policy of ['reject', 'absorb'] as const) {
        const visited: Array<{ field: string; kind: string }> = [];
        forEachReportScopeField({}, policy, (field, kind, value) => {
          expect(value).toBeUndefined();
          visited.push({ field, kind });
        });
        expect(visited.map((v) => v.field).sort()).toEqual([...ALL_TABLE_FIELDS].sort());
        expect(new Set(visited.map((v) => v.field)).size).toBe(ALL_TABLE_FIELDS.length);
      }
    });

    it('fails closed on an unknown policy', () => {
      expect(() =>
        forEachReportScopeField({}, 'coerce' as never, () => {}),
      ).toThrow(/Unknown report scope policy/);
    });
  });

  describe('reject/absorb split per field', () => {
    it('rejects non-string scope strings while the normalizer degrades them to absent', () => {
      expect(REPORT_SCOPE_STRING_FIELDS.length).toBeGreaterThan(0);
      for (const field of REPORT_SCOPE_STRING_FIELDS) {
        expect(() => validateScope({ [field]: 123 })).toThrow(ValidationError);
        expect(() => validateScope({ [field]: 123 })).toThrow(`payload.scope.${field} must be string`);
        expect(normalizeReportScope({ [field]: 123 })).toEqual({});
      }
    });

    it('rejects non-finite scope numbers while the normalizer degrades them to absent', () => {
      expect(REPORT_SCOPE_NUMBER_FIELDS.length).toBeGreaterThan(0);
      for (const field of REPORT_SCOPE_NUMBER_FIELDS) {
        expect(() => validateScope({ [field]: 'x' })).toThrow(ValidationError);
        expect(() => validateScope({ [field]: 'x' })).toThrow(`payload.scope.${field} must be finite number`);
        expect(() => validateScope({ [field]: NaN })).toThrow(ValidationError);
        expect(normalizeReportScope({ [field]: 'x' })).toEqual({});
      }
    });

    it('rejects non-array ids and bad id entries while the normalizer absorbs them', () => {
      expect(REPORT_SCOPE_ARRAY_FIELDS.length).toBeGreaterThan(0);
      for (const field of REPORT_SCOPE_ARRAY_FIELDS) {
        expect(() => validateScope({ [field]: 'x' })).toThrow(`payload.scope.${field} must be array`);
        expect(() => validateScope({ [field]: [1, -2] })).toThrow(
          `payload.scope.${field} must be non-negative integers`,
        );
        // Absorb side: a non-array degrades to absent, bad entries are dropped.
        expect(normalizeReportScope({ [field]: 'x' })).toEqual({});
        expect(normalizeReportScope({ [field]: [1, -2, 3] })).toEqual({ [field]: [1, 3] });
      }
    });
  });
});
