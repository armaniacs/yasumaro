/**
 * archivePayloadValidation-parity.test.ts (PBI 2026-10-09-01 / NN01)
 *
 * The 5 archive subtypes with payload checks (preview / create / export /
 * query / update) cross TWO hand-written gates on the same request:
 *
 *   1. envelope gate — DASHBOARD_SQLITE_SUBTYPE_SPECS in validators.ts
 *      (MessageRouter runs it first in production)
 *   2. handler gate  — the `validate` lambda on each ARCHIVE_WIRE_TABLE row
 *
 * Both gates used to be typed out independently, so a bound could be added to
 * one gate and missed on the other (archive_export's 8MB length cap, archive_query's
 * limit literal). This test pins, per shared field/bound, the accept/reject
 * outcome of BOTH gates and that they agree — so a one-sided change to the
 * bound fails here instead of surviving unnoticed.
 *
 * Divergences that NN01 deliberately does not close (they sit outside the
 * bound-drift scope and carry domain semantics: cutoff-pair verification,
 * includeDeleted / yasumaroVersion presence, query length cap) are pinned
 * separately at the bottom so they cannot change silently either.
 */
import { describe, it, expect } from 'vitest';
import { dashboardSqliteValidator } from '../validators.js';
import { ARCHIVE_WIRE_TABLE, type DashboardArchiveSubtype } from '../archiveWireTable.js';
import { cutoffMsFromLocalDate } from '../../utils/archiveGuards.js';
import {
  MAX_ARCHIVE_EXPORT_CHUNK_BYTES,
  MAX_ARCHIVE_QUERY_LIMIT,
  VALIDATOR_LIMITS,
} from '../../utils/limits.js';

type Gate = 'accept' | 'reject';

function envelopeGate(payload: Record<string, unknown>): Gate {
  try {
    dashboardSqliteValidator.validate(payload);
    return 'accept';
  } catch {
    return 'reject';
  }
}

function wireResult(subtype: DashboardArchiveSubtype, payload: Record<string, unknown>): string | null {
  const descriptor = ARCHIVE_WIRE_TABLE.find((entry) => entry.subtype === subtype);
  if (!descriptor) throw new Error(`no archive wire row for ${subtype}`);
  return descriptor.validate(payload);
}

function wireGate(subtype: DashboardArchiveSubtype, payload: Record<string, unknown>): Gate {
  return wireResult(subtype, payload) === null ? 'accept' : 'reject';
}

const STAGING = 'archive_outgoing_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db';
const CUTOFF_DATE = '2020-01-01';
const CUTOFF_MS = cutoffMsFromLocalDate(CUTOFF_DATE);

const BASE: Readonly<Record<DashboardArchiveSubtype, Record<string, unknown>>> = {
  archive_preview: {
    subtype: 'archive_preview',
    cutoffDate: CUTOFF_DATE,
    cutoffMs: CUTOFF_MS,
    includeDeleted: false,
  },
  archive_create: {
    subtype: 'archive_create',
    cutoffDate: CUTOFF_DATE,
    cutoffMs: CUTOFF_MS,
    includeDeleted: false,
    yasumaroVersion: '1.0.0',
  },
  archive_export: { subtype: 'archive_export', stagingName: STAGING, offset: 0, length: 1 },
  archive_query: { subtype: 'archive_query', stagingName: STAGING, query: '', limit: 1, offset: 0 },
  archive_update: { subtype: 'archive_update', stagingName: STAGING, id: 1, changes: { summary: 'x' } },
};

interface ParityCase {
  name: string;
  subtype: DashboardArchiveSubtype;
  patch: Record<string, unknown>;
  envelope: Gate;
  wire: Gate;
}

/**
 * Each row mutates ONE shared field of a payload both gates accept, and pins
 * both gates' outcome (and therefore their agreement). archive_export.length
 * over the 8MB bound is the drift this PBI closes: before the fix the wire
 * gate accepted it while the envelope gate rejected it.
 */
const PARITY_CASES: readonly ParityCase[] = [
  { name: 'archive_preview: canonical payload', subtype: 'archive_preview', patch: {}, envelope: 'accept', wire: 'accept' },
  { name: 'archive_create: canonical payload', subtype: 'archive_create', patch: {}, envelope: 'accept', wire: 'accept' },
  { name: 'archive_export: canonical payload', subtype: 'archive_export', patch: {}, envelope: 'accept', wire: 'accept' },
  { name: 'archive_query: canonical payload', subtype: 'archive_query', patch: {}, envelope: 'accept', wire: 'accept' },
  { name: 'archive_update: canonical payload', subtype: 'archive_update', patch: {}, envelope: 'accept', wire: 'accept' },

  { name: 'archive_preview: empty cutoffDate', subtype: 'archive_preview', patch: { cutoffDate: '' }, envelope: 'reject', wire: 'reject' },
  { name: 'archive_preview: non-string cutoffDate', subtype: 'archive_preview', patch: { cutoffDate: 5 }, envelope: 'reject', wire: 'reject' },
  { name: 'archive_preview: non-number cutoffMs', subtype: 'archive_preview', patch: { cutoffMs: 'x' }, envelope: 'reject', wire: 'reject' },

  { name: 'archive_create: empty cutoffDate', subtype: 'archive_create', patch: { cutoffDate: '' }, envelope: 'reject', wire: 'reject' },
  { name: 'archive_create: non-number cutoffMs', subtype: 'archive_create', patch: { cutoffMs: 'x' }, envelope: 'reject', wire: 'reject' },

  { name: 'archive_export: negative offset', subtype: 'archive_export', patch: { offset: -1 }, envelope: 'reject', wire: 'reject' },
  { name: 'archive_export: fractional offset', subtype: 'archive_export', patch: { offset: 1.5 }, envelope: 'reject', wire: 'reject' },
  { name: 'archive_export: length 0', subtype: 'archive_export', patch: { length: 0 }, envelope: 'reject', wire: 'reject' },
  { name: 'archive_export: length at 8MB bound', subtype: 'archive_export', patch: { length: MAX_ARCHIVE_EXPORT_CHUNK_BYTES }, envelope: 'accept', wire: 'accept' },
  { name: 'archive_export: length over 8MB bound', subtype: 'archive_export', patch: { length: MAX_ARCHIVE_EXPORT_CHUNK_BYTES + 1 }, envelope: 'reject', wire: 'reject' },
  { name: 'archive_export: fractional length', subtype: 'archive_export', patch: { length: 1.5 }, envelope: 'reject', wire: 'reject' },

  { name: 'archive_query: non-string query', subtype: 'archive_query', patch: { query: 5 }, envelope: 'reject', wire: 'reject' },
  { name: 'archive_query: limit at registry bound', subtype: 'archive_query', patch: { limit: MAX_ARCHIVE_QUERY_LIMIT }, envelope: 'accept', wire: 'accept' },
  { name: 'archive_query: limit over registry bound', subtype: 'archive_query', patch: { limit: MAX_ARCHIVE_QUERY_LIMIT + 1 }, envelope: 'reject', wire: 'reject' },
  { name: 'archive_query: limit 0', subtype: 'archive_query', patch: { limit: 0 }, envelope: 'reject', wire: 'reject' },
  { name: 'archive_query: negative offset', subtype: 'archive_query', patch: { offset: -1 }, envelope: 'reject', wire: 'reject' },

  { name: 'archive_update: id 0', subtype: 'archive_update', patch: { id: 0 }, envelope: 'reject', wire: 'reject' },
  { name: 'archive_update: fractional id', subtype: 'archive_update', patch: { id: 1.5 }, envelope: 'reject', wire: 'reject' },
  { name: 'archive_update: null changes', subtype: 'archive_update', patch: { changes: null }, envelope: 'reject', wire: 'reject' },
  { name: 'archive_update: array changes', subtype: 'archive_update', patch: { changes: [] }, envelope: 'reject', wire: 'reject' },
];

describe('archive payload validation parity: envelope spec vs wire-table validate (NN01)', () => {
  for (const c of PARITY_CASES) {
    it(c.name, () => {
      const payload = { ...BASE[c.subtype], ...c.patch };
      const envelope = envelopeGate(payload);
      const wire = wireGate(c.subtype, payload);
      expect(envelope, 'envelope gate').toBe(c.envelope);
      expect(wire, 'wire gate').toBe(c.wire);
      expect(wire, 'the two gates must agree').toBe(envelope);
    });
  }

  it('both gates enforce the 8MB export bound and the 500 query limit from the registry', () => {
    expect(MAX_ARCHIVE_EXPORT_CHUNK_BYTES).toBe(8 * 1024 * 1024);
    expect(MAX_ARCHIVE_QUERY_LIMIT).toBe(500);

    // The wire error text tracks the registry constant, so a bare literal
    // cannot silently stand in for it.
    expect(wireResult('archive_query', { ...BASE.archive_query, limit: MAX_ARCHIVE_QUERY_LIMIT + 1 })).toBe(
      `archive_query: limit must be 1..${MAX_ARCHIVE_QUERY_LIMIT}`,
    );
    expect(
      wireResult('archive_export', { ...BASE.archive_export, length: MAX_ARCHIVE_EXPORT_CHUNK_BYTES + 1 }),
    ).toBe('archive_export: length must be a positive number');
  });
});

/**
 * Divergences NN01 does not close. They are domain checks (pair verification,
 * required-field presence, query text cap), not the numeric bounds the PBI
 * targets, and changing them would alter accept/reject outcomes outside the
 * declared scope. Pinned here so a silent change to either side fails.
 */
describe('archive payload validation: known divergences outside NN01 scope (pinned)', () => {
  it('envelope requires includeDeleted / yasumaroVersion presence; the wire row does not', () => {
    const previewNoFlag = { subtype: 'archive_preview', cutoffDate: CUTOFF_DATE, cutoffMs: CUTOFF_MS };
    expect(envelopeGate(previewNoFlag)).toBe('reject');
    expect(wireGate('archive_preview', previewNoFlag)).toBe('accept');

    const createNoVersion = { subtype: 'archive_create', cutoffDate: CUTOFF_DATE, cutoffMs: CUTOFF_MS, includeDeleted: false };
    expect(envelopeGate(createNoVersion)).toBe('reject');
    expect(wireGate('archive_create', createNoVersion)).toBe('accept');
  });

  it('envelope verifies the cutoff pair and caps archive_query length; the wire row does not', () => {
    const forgedPair = { subtype: 'archive_preview', cutoffDate: CUTOFF_DATE, cutoffMs: CUTOFF_MS + 1, includeDeleted: false };
    expect(envelopeGate(forgedPair)).toBe('reject');
    expect(wireGate('archive_preview', forgedPair)).toBe('accept');

    const longQuery = { ...BASE.archive_query, query: 'q'.repeat(VALIDATOR_LIMITS.MAX_SEARCH_QUERY_LENGTH + 1) };
    expect(envelopeGate(longQuery)).toBe('reject');
    expect(wireGate('archive_query', longQuery)).toBe('accept');
  });
});
