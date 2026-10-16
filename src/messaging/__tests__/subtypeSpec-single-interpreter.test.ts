/**
 * subtypeSpec-single-interpreter.test.ts
 *
 * DASHBOARD_SQLITE_SUBTYPE_SPECS used to be interpreted by TWO typed-out
 * loops: `evaluateSubtypeSpec` for the archive wire table, and an inline copy
 * inside `DashboardSqliteValidator.validate`. PBI 2026-10-11-10 replaced the
 * wire rows' hand-written checks with the shared evaluator, but the envelope
 * gate kept its own copy of the loop — so any change to `optional` handling
 * or field attachment had to be made twice for the two gates to stay in
 * agreement (Refactoring Evangelist: single-interpreter miss).
 *
 * Both presentations now render ONE `interpretSubtypeSpec` result. In the
 * style of search-statement-twins-equivalence.test.ts this pins:
 *
 *   1. behaviour — for every failure mode (field row, optional skip,
 *      guardFirst, guardLast, unknown subtype) the wire message, the envelope
 *      ValidationError (message + field + identity of a rethrown guard error)
 *      and both accept/reject verdicts are exactly what the single
 *      interpreter produced;
 *   2. structure — the spec-field loop exists exactly once under src/, and
 *      neither presentation carries an interpretation of its own, so a
 *      second interpreter cannot be typed out again unnoticed.
 *
 * Scope note: ARCHIVE_WIRE_TABLE's archive_update row predates the
 * interpreter and stays hand-written (no stagingName guard on that path); it
 * is excluded here and remains pinned by archivePayloadValidation-parity.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dashboardSqliteValidator,
  evaluateSubtypeSpec,
  interpretSubtypeSpec,
  ValidationError,
  type SubtypeSpecFailure,
} from '../validators.js';
import { ARCHIVE_WIRE_TABLE, type DashboardArchiveSubtype } from '../archiveWireTable.js';
import { cutoffMsFromLocalDate } from '../../utils/archiveGuards.js';
import {
  MAX_ARCHIVE_EXPORT_CHUNK_BYTES,
  MAX_ARCHIVE_QUERY_LIMIT,
  VALIDATOR_LIMITS,
} from '../../utils/limits.js';

const STAGING = 'archive_outgoing_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db';
const CUTOFF_DATE = '2020-01-01';
const CUTOFF_MS = cutoffMsFromLocalDate(CUTOFF_DATE);

/** Wire-table row that delegates to evaluateSubtypeSpec (archive_update is
 *  hand-written by design and therefore not listed here). */
function wireResult(subtype: DashboardArchiveSubtype, payload: Record<string, unknown>): string | null {
  const descriptor = ARCHIVE_WIRE_TABLE.find((entry) => entry.subtype === subtype);
  if (!descriptor) throw new Error(`no archive wire row for ${subtype}`);
  return descriptor.validate(payload);
}

function envelopeAccepts(payload: Record<string, unknown>): boolean {
  try {
    dashboardSqliteValidator.validate(payload);
    return true;
  } catch {
    return false;
  }
}

/** @returns the ValidationError the envelope gate rejected with; throws when the gate accepted or threw something else. */
function envelopeRejection(payload: Record<string, unknown>): ValidationError {
  try {
    dashboardSqliteValidator.validate(payload);
  } catch (error) {
    if (error instanceof ValidationError) return error;
    throw error;
  }
  throw new Error('expected the envelope gate to reject the payload');
}

function mustFail(failure: SubtypeSpecFailure | null): SubtypeSpecFailure {
  if (failure === null) {
    throw new Error('expected interpretSubtypeSpec to reject the payload, but it accepted');
  }
  return failure;
}

interface SingleInterpreterCase {
  name: string;
  subtype: string;
  payload: Record<string, unknown>;
  accepted: boolean;
  /** Field carried by the envelope ValidationError (reject cases only). */
  field?: string;
  /** Which part of the spec row produced the failure (reject cases only). */
  via?: 'field-row' | 'guard';
  /** Delegating wire-table row to cross-check (present on archive rows only). */
  wire?: DashboardArchiveSubtype;
}

const CASES: readonly SingleInterpreterCase[] = [
  // --- accepted: interpreter null, wire null, envelope silent ---
  {
    name: 'archive_preview: consistent cutoff pair accepted',
    subtype: 'archive_preview',
    payload: { subtype: 'archive_preview', cutoffDate: CUTOFF_DATE, cutoffMs: CUTOFF_MS, includeDeleted: false },
    accepted: true,
    wire: 'archive_preview',
  },
  {
    name: 'archive_create: canonical payload accepted',
    subtype: 'archive_create',
    payload: { subtype: 'archive_create', cutoffDate: CUTOFF_DATE, cutoffMs: CUTOFF_MS, includeDeleted: false, yasumaroVersion: '6.7.113' },
    accepted: true,
    wire: 'archive_create',
  },
  {
    name: 'archive_export: canonical payload accepted',
    subtype: 'archive_export',
    payload: { subtype: 'archive_export', stagingName: STAGING, offset: 0, length: 1 },
    accepted: true,
    wire: 'archive_export',
  },
  {
    name: 'archive_query: canonical payload accepted',
    subtype: 'archive_query',
    payload: { subtype: 'archive_query', stagingName: STAGING, query: 'q', limit: 1, offset: 0 },
    accepted: true,
    wire: 'archive_query',
  },
  {
    name: 'create_confirm_token: omitted optional id accepted (optional skip lives in the one interpreter)',
    subtype: 'create_confirm_token',
    payload: { subtype: 'create_confirm_token', action: 'delete' },
    accepted: true,
  },
  {
    name: 'search: minimal payload accepted',
    subtype: 'search',
    payload: { subtype: 'search', query: 'hello' },
    accepted: true,
  },
  {
    name: 'import: empty rows accepted before the guardLast byte estimate',
    subtype: 'import',
    payload: { subtype: 'import', rows: [] },
    accepted: true,
  },

  // --- field-row rejections: failure.field and the wrapped ValidationError agree ---
  {
    name: 'archive_export: length over the 8MB cap rejects on the field row',
    subtype: 'archive_export',
    payload: { subtype: 'archive_export', stagingName: STAGING, offset: 0, length: MAX_ARCHIVE_EXPORT_CHUNK_BYTES + 1 },
    accepted: false,
    field: 'length',
    via: 'field-row',
    wire: 'archive_export',
  },
  {
    name: 'archive_query: limit over the registry cap rejects on the field row',
    subtype: 'archive_query',
    payload: { subtype: 'archive_query', stagingName: STAGING, query: 'q', limit: MAX_ARCHIVE_QUERY_LIMIT + 1, offset: 0 },
    accepted: false,
    field: 'limit',
    via: 'field-row',
    wire: 'archive_query',
  },
  {
    name: 'archive_query: over-long query text rejects on the field row',
    subtype: 'archive_query',
    payload: {
      subtype: 'archive_query',
      stagingName: STAGING,
      query: 'q'.repeat(VALIDATOR_LIMITS.MAX_SEARCH_QUERY_LENGTH + 1),
      limit: 1,
      offset: 0,
    },
    accepted: false,
    field: 'query',
    via: 'field-row',
    wire: 'archive_query',
  },
  {
    name: 'archive_create: over-long yasumaroVersion rejects on the field row',
    subtype: 'archive_create',
    payload: {
      subtype: 'archive_create',
      cutoffDate: CUTOFF_DATE,
      cutoffMs: CUTOFF_MS,
      includeDeleted: false,
      yasumaroVersion: 'v'.repeat(65),
    },
    accepted: false,
    field: 'yasumaroVersion',
    via: 'field-row',
    wire: 'archive_create',
  },
  {
    name: 'create_confirm_token: present-but-invalid optional id rejects on the field row',
    subtype: 'create_confirm_token',
    payload: { subtype: 'create_confirm_token', action: 'delete', id: 'not-a-number' },
    accepted: false,
    field: 'id',
    via: 'field-row',
  },
  {
    name: 'search: query over the length cap rejects on the field row',
    subtype: 'search',
    payload: { subtype: 'search', query: 'q'.repeat(VALIDATOR_LIMITS.MAX_SEARCH_QUERY_LENGTH + 1) },
    accepted: false,
    field: 'query',
    via: 'field-row',
  },
  {
    name: 'import: too many rows reject on the field row before guardLast runs',
    subtype: 'import',
    payload: { subtype: 'import', rows: Array.from({ length: VALIDATOR_LIMITS.MAX_IMPORT_ROWS + 1 }, () => 1) },
    accepted: false,
    field: 'rows',
    via: 'field-row',
  },

  // --- guardFirst rejections: the guard's own ValidationError is rethrown verbatim ---
  {
    name: 'archive_preview: forged cutoffMs is rejected by guardFirst and rethrown verbatim',
    subtype: 'archive_preview',
    payload: { subtype: 'archive_preview', cutoffDate: CUTOFF_DATE, cutoffMs: CUTOFF_MS + 1, includeDeleted: false },
    accepted: false,
    field: 'cutoffMs',
    via: 'guard',
    wire: 'archive_preview',
  },
  {
    name: 'archive_preview: missing includeDeleted is rejected by guardFirst',
    subtype: 'archive_preview',
    payload: { subtype: 'archive_preview', cutoffDate: CUTOFF_DATE, cutoffMs: CUTOFF_MS },
    accepted: false,
    field: 'includeDeleted',
    via: 'guard',
    wire: 'archive_preview',
  },
  {
    name: 'archive_export: non-staging name is rejected by guardFirst',
    subtype: 'archive_export',
    payload: { subtype: 'archive_export', stagingName: 'yasumaro.db', offset: 0, length: 1 },
    accepted: false,
    field: 'stagingName',
    via: 'guard',
    wire: 'archive_export',
  },

  // --- guardLast rejection ---
  {
    name: 'import: byte estimate over MAX_IMPORT_BYTES is rejected by guardLast and rethrown verbatim',
    subtype: 'import',
    payload: { subtype: 'import', rows: ['x'.repeat(VALIDATOR_LIMITS.MAX_IMPORT_BYTES)] },
    accepted: false,
    field: 'rows',
    via: 'guard',
  },
];

describe('messaging/validators: subtype spec single interpreter', () => {
  describe('evaluateSubtypeSpec / wire row vs DashboardSqliteValidator.validate', () => {
    for (const c of CASES) {
      it(c.name, () => {
        const failure = interpretSubtypeSpec(c.subtype, c.payload);
        const direct = evaluateSubtypeSpec(c.subtype, c.payload);

        if (c.accepted) {
          expect(failure).toBeNull();
          expect(direct).toBeNull();
          if (c.wire) expect(wireResult(c.wire, c.payload)).toBeNull();
          expect(envelopeAccepts(c.payload)).toBe(true);
          return;
        }

        const rejected = mustFail(failure);
        // Both presentations render the same message the interpreter produced.
        expect(direct).toBe(rejected.message);
        if (c.wire) expect(wireResult(c.wire, c.payload)).toBe(rejected.message);

        const error = envelopeRejection(c.payload);
        expect(error.message).toBe(rejected.message);
        expect(error.field).toBe(c.field);
        expect(error.validatorName).toBe('DashboardSqliteValidator');
        expect(envelopeAccepts(c.payload)).toBe(false);

        if (c.via === 'guard') {
          // The interpreter captured the guard's own ValidationError: its
          // message/field are what the envelope propagated (the envelope
          // rethrows `cause` verbatim — pinned by the structure test below;
          // identity cannot be compared across two interpreter invocations).
          const cause = rejected.cause;
          expect(cause).toBeInstanceOf(ValidationError);
          if (cause instanceof ValidationError) {
            expect(cause.message).toBe(rejected.message);
            expect(cause.field).toBe(c.field);
          }
        } else {
          expect(rejected.cause).toBeUndefined();
          expect(rejected.field).toBe(c.field);
        }
      });
    }

    it('rejects an unknown subtype on both presentations (fail-closed, PBI 2026-10-16-01)', () => {
      const payload = { subtype: 'not_a_subtype', junk: 1 };
      // No spec row and not a known subtype: the interpreter rejects, so the
      // wire presentation (which never passes the envelope pre-gate) cannot
      // let an unknown subtype through. The envelope pre-gate rejects earlier
      // with the byte-identical text, so both presentations still agree.
      const rejected = mustFail(interpretSubtypeSpec('not_a_subtype', payload));
      expect(rejected.field).toBe('subtype');
      expect(rejected.cause).toBeUndefined();
      expect(evaluateSubtypeSpec('not_a_subtype', payload)).toBe(rejected.message);
      const error = envelopeRejection(payload);
      expect(error.message).toBe(rejected.message);
      expect(error.field).toBe('subtype');
      expect(envelopeAccepts(payload)).toBe(false);
    });

    it('still passes a known subtype that intentionally carries no spec row', () => {
      const payload = { subtype: 'query', anything: 'goes' };
      // `query` accepts arbitrary extra fields by design — only truly unknown
      // subtypes are rejected, so the fail-closed change stays limited to them.
      expect(interpretSubtypeSpec('query', payload)).toBeNull();
      expect(evaluateSubtypeSpec('query', payload)).toBeNull();
      expect(envelopeAccepts(payload)).toBe(true);
    });
  });

  describe('structure pin: one interpretation path', () => {
    const SRC_DIR = fileURLToPath(new URL('../../', import.meta.url));

    function collectProductionSources(dir: string, acc: string[] = []): string[] {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
          collectProductionSources(join(dir, entry.name), acc);
        } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
          acc.push(join(dir, entry.name));
        }
      }
      return acc;
    }

    function repoRelative(file: string): string {
      return relative(SRC_DIR, file).split(sep).join('/');
    }

    it('interprets spec rows in exactly one place under src/', () => {
      const sources = collectProductionSources(SRC_DIR);
      const texts = new Map(sources.map((f) => [f, readFileSync(f, 'utf-8')]));

      const withFieldLoop = sources.filter((f) => texts.get(f)?.includes('spec.fields ?? []') === true);
      expect(withFieldLoop.map(repoRelative), 'the spec-field loop must exist exactly once').toEqual([
        'messaging/validators.ts',
      ]);

      const validatorsSource = texts.get(join(SRC_DIR, 'messaging', 'validators.ts'));
      expect(validatorsSource).toBeDefined();
      if (validatorsSource === undefined) return;
      expect(validatorsSource.match(/for \(const f of spec\.fields \?\? \[\]\)/g) ?? []).toHaveLength(1);
      expect(validatorsSource.match(/f\.optional && p\[f\.field\] === undefined/g) ?? []).toHaveLength(1);

      const tableIndexers = sources.filter((f) => texts.get(f)?.includes('DASHBOARD_SQLITE_SUBTYPE_SPECS[') === true);
      expect(tableIndexers.map(repoRelative), 'only the interpreter may index the spec table').toEqual([
        'messaging/validators.ts',
      ]);
    });

    it('keeps both presentations free of their own interpretation loop', () => {
      const source = readFileSync(join(SRC_DIR, 'messaging', 'validators.ts'), 'utf-8');

      const wireStart = source.indexOf('export function evaluateSubtypeSpec');
      const wireEnd = source.indexOf('/** Subtypes whose payload carries');
      expect(wireStart).toBeGreaterThan(-1);
      expect(wireEnd).toBeGreaterThan(wireStart);
      const wirePresentation = source.slice(wireStart, wireEnd);
      expect(wirePresentation).toContain('interpretSubtypeSpec(subtype, payload)');
      expect(wirePresentation).not.toContain('spec.fields');
      expect(wirePresentation).not.toContain('guardFirst?.(');
      expect(wirePresentation).not.toContain('guardLast?.(');

      const envelopeStart = source.indexOf('export class DashboardSqliteValidator');
      const envelopeEnd = source.indexOf('export class FetchUrlValidator');
      expect(envelopeStart).toBeGreaterThan(-1);
      expect(envelopeEnd).toBeGreaterThan(envelopeStart);
      const envelopePresentation = source.slice(envelopeStart, envelopeEnd);
      expect(envelopePresentation).toContain('interpretSubtypeSpec(subtype, p)');
      // A guard's own ValidationError propagates verbatim (validatorName,
      // field and stack stay the guard's) instead of being re-wrapped.
      expect(envelopePresentation).toContain('throw failure.cause');
      expect(envelopePresentation).not.toContain('spec.fields');
      expect(envelopePresentation).not.toContain('guardFirst?.(');
      expect(envelopePresentation).not.toContain('guardLast?.(');
    });
  });
});
