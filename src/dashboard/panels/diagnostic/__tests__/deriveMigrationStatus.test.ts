import { describe, it, expect } from 'vitest';
import { deriveMigrationStatus } from '../diagnosticsPanel.js';
import type { DiagnosticsSnapshot } from '../DiagnosticsCollector.js';

function sqlite(overrides: Partial<NonNullable<DiagnosticsSnapshot['sqlite']>> = {}): NonNullable<DiagnosticsSnapshot['sqlite']> {
  return {
    initialized: true,
    path: 'OPFS:/test.db',
    fallback: false,
    fts5: true,
    opfsMigrationV2Done: true,
    idbMigrationV2Done: true,
    ...overrides,
  };
}

describe('deriveMigrationStatus', () => {
  it('reports allDone when both migration flags are true', () => {
    const status = deriveMigrationStatus(sqlite());

    expect(status.overall.allDone).toBe(true);
    expect(status.overall.checking).toBe(false);
    expect(status.overall.warn).toBe(false);
    expect(status.opfs.done).toBe(true);
    expect(status.idb.done).toBe(true);
  });

  it('reports not-done overall when either migration flag is false', () => {
    const status = deriveMigrationStatus(sqlite({ idbMigrationV2Done: false, idbLegacyDbName: 'idb-batch-atomic' }));

    expect(status.overall.allDone).toBe(false);
    expect(status.overall.warn).toBe(true);
    expect(status.idb.done).toBe(false);
    expect(status.idb.warn).toBe(true);
    expect(status.idb.notApplicable).toBe(false);
  });

  it('treats null sqlite as fully not-done (caller renders the failure message separately)', () => {
    const status = deriveMigrationStatus(null);

    expect(status.overall.allDone).toBe(false);
    expect(status.opfs.done).toBe(false);
    expect(status.idb.done).toBe(false);
  });

  it('marks OPFS as checking (not a warning) when migration has not been attempted yet', () => {
    const status = deriveMigrationStatus(sqlite({
      opfsMigrationV2Done: false,
      opfsMigrationV2LastAttemptedAt: null,
    }));

    expect(status.opfs.checking).toBe(true);
    expect(status.opfs.warn).toBe(false);
    expect(status.overall.checking).toBe(true);
    expect(status.overall.warn).toBe(false);
    expect(status.hints).toContain('opfsCheckingStale');
  });

  it('marks OPFS as pending/warn when migration was attempted but not done', () => {
    const status = deriveMigrationStatus(sqlite({
      opfsMigrationV2Done: false,
      opfsMigrationV2LastAttemptedAt: '2026-08-29T00:00:00.000Z',
    }));

    expect(status.opfs.checking).toBe(false);
    expect(status.opfs.warn).toBe(true);
    expect(status.overall.checking).toBe(false);
    expect(status.overall.warn).toBe(true);
    expect(status.hints).not.toContain('opfsCheckingStale');
  });

  it('marks IDB as not-applicable (no warning) when done=false but no legacy IDB DB was found', () => {
    const status = deriveMigrationStatus(sqlite({
      idbMigrationV2Done: false,
      idbLegacyDbName: null,
    }));

    expect(status.idb.notApplicable).toBe(true);
    expect(status.idb.warn).toBe(false);
    expect(status.overall.allDone).toBe(true);
  });

  it('marks IDB as pending/warn when done=false and a legacy IDB DB was found', () => {
    const status = deriveMigrationStatus(sqlite({
      idbMigrationV2Done: false,
      idbLegacyDbName: 'idb-batch-atomic',
    }));

    expect(status.idb.notApplicable).toBe(false);
    expect(status.idb.warn).toBe(true);
    expect(status.idb.legacyName).toBe('idb-batch-atomic');
  });

  it('marks OPFS as not-applicable (no warning) when done=false but no legacy OPFS DB was found', () => {
    const status = deriveMigrationStatus(sqlite({
      opfsMigrationV2Done: false,
      opfsLegacyDbPath: null,
    }));

    expect(status.opfs.notApplicable).toBe(true);
    expect(status.opfs.warn).toBe(false);
    expect(status.opfs.checking).toBe(false);
  });

  it('exposes raw OPFS attempt fields for the renderer to surface', () => {
    const status = deriveMigrationStatus(sqlite({
      opfsMigrationV2LastAttemptedAt: '2026-08-29T00:00:00.000Z',
      opfsMigrationV2CompletedAt: '2026-08-29T00:05:00.000Z',
      opfsMigrationV2RecordCount: 42,
    }));

    expect(status.opfs.lastAttemptedAt).toBe('2026-08-29T00:00:00.000Z');
    expect(status.opfs.completedAt).toBe('2026-08-29T00:05:00.000Z');
    expect(status.opfs.recordCount).toBe(42);
  });

  it('flags legacyStillPresent when OPFS migration is done but the legacy DB is still on disk', () => {
    const status = deriveMigrationStatus(sqlite({
      opfsMigrationV2Done: true,
      opfsLegacyDbPath: 'sqlite-pool/yasumaro.db',
    }));

    expect(status.opfs.done).toBe(true);
    expect(status.opfs.legacyStillPresent).toBe(true);
    expect(status.hints).toContain('legacyStillPresent');
  });

  it('does not flag legacyStillPresent when the probe could not confirm (undefined)', () => {
    const status = deriveMigrationStatus(sqlite({ opfsMigrationV2Done: true }));

    expect(status.opfs.legacyStillPresent).toBe(false);
    expect(status.hints).not.toContain('legacyStillPresent');
  });

  it('does not flag legacyStillPresent when the legacy DB is confirmed absent', () => {
    const status = deriveMigrationStatus(sqlite({
      opfsMigrationV2Done: true,
      opfsLegacyDbPath: null,
    }));

    expect(status.opfs.legacyStillPresent).toBe(false);
  });

  it('flags legacyStillPresent on the IDB side independently', () => {
    const status = deriveMigrationStatus(sqlite({
      idbMigrationV2Done: true,
      idbLegacyDbName: 'idb-batch-atomic',
    }));

    expect(status.idb.legacyStillPresent).toBe(true);
    expect(status.hints).toContain('legacyStillPresent');
  });

  it('always includes the two static explanatory hints', () => {
    const status = deriveMigrationStatus(sqlite());

    expect(status.hints).toContain('noAbsolutePath');
    expect(status.hints).toContain('idbExplanation');
  });
});
