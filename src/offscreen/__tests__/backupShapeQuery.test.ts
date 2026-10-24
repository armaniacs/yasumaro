/**
 * backupShapeQuery.test.ts (PBI 2026-10-24-06)
 * Table tests for the centralized backup shape query plus retire/restore
 * flow coverage: every shape is produced by its real codec and classified
 * back to the same shape, and every shape dispatches to its unchanged
 * restore target.
 */
import { describe, it, expect } from 'vitest';
import {
  capabilitiesFromFlags,
  capabilitiesForBackend,
  hasArchiveCapability,
  resolveBackupShape,
  restoreTargetForShape,
  classifyBackupPayload,
  ARCHIVE_UNSUPPORTED_ERROR,
  type BackupCapabilities,
  type BackupWants,
} from '../StorageBackend.js';
import { supportsArchive } from '../archiveStaging.js';
import {
  buildExportEnvelope,
  isExportEnvelopePayload,
  EXPORT_TABLE,
  EXPORT_VERSION,
} from '../exportEnvelope.js';
import { resolveBackupShape as resolveViaDbMaintenance } from '../dbMaintenance.js';
import {
  isSettingsBackupKey,
  hasSettingsBackupGeneration,
  listSettingsBackupKeys,
  LEGACY_SETTINGS_BACKUP_KEY,
} from '../../utils/storage/settingsBackup.js';
import {
  isEncryptedExport,
  isPlaintextSettingsPayload,
  EXPORT_VERSION as SETTINGS_EXPORT_VERSION,
} from '../../utils/settingsExportImport.js';

describe('backupShapeQuery', () => {
  describe('resolveBackupShape', () => {
    const cases: Array<{
      name: string;
      wants: BackupWants;
      caps: BackupCapabilities;
      expected: ReturnType<typeof resolveBackupShape>;
    }> = [
      {
        name: 'database with binary preference and capability selects binary',
        wants: { kind: 'database', preferBinary: true },
        caps: { supportsBinaryBackup: true, supportsArchive: false },
        expected: 'binary',
      },
      {
        name: 'database without binary preference selects envelope even when capable',
        wants: { kind: 'database', preferBinary: false },
        caps: { supportsBinaryBackup: true, supportsArchive: false },
        expected: 'envelope',
      },
      {
        name: 'database with binary preference falls back to envelope without capability',
        wants: { kind: 'database', preferBinary: true },
        caps: { supportsBinaryBackup: false, supportsArchive: false },
        expected: 'envelope',
      },
      {
        name: 'database without preference selects envelope without capability',
        wants: { kind: 'database' },
        caps: { supportsBinaryBackup: false, supportsArchive: false },
        expected: 'envelope',
      },
      {
        name: 'settings selects settings regardless of adapter capability',
        wants: { kind: 'settings' },
        caps: { supportsBinaryBackup: false, supportsArchive: false },
        expected: 'settings',
      },
      {
        name: 'settings selects settings on a fully capable adapter',
        wants: { kind: 'settings' },
        caps: { supportsBinaryBackup: true, supportsArchive: true },
        expected: 'settings',
      },
      {
        name: 'archive selects archive on a staging adapter',
        wants: { kind: 'archive' },
        caps: { supportsBinaryBackup: true, supportsArchive: true },
        expected: 'archive',
      },
      {
        name: 'archive fails closed without OPFS (no silent fallback shape)',
        wants: { kind: 'archive' },
        caps: { supportsBinaryBackup: true, supportsArchive: false },
        expected: null,
      },
    ];

    for (const { name, wants, caps, expected } of cases) {
      it(name, () => {
        expect(resolveBackupShape(wants, caps)).toBe(expected);
      });
    }

    it('returns the archive fail-closed error contract for a null shape', () => {
      const shape = resolveBackupShape({ kind: 'archive' }, capabilitiesFromFlags({
        supportsBinaryBackup: false,
        supportsArchive: false,
      }));
      expect(shape).toBeNull();
      expect(ARCHIVE_UNSUPPORTED_ERROR).toBe('Archive requires OPFS storage.');
    });
  });

  describe('classifyBackupPayload', () => {
    it('classifies raw bytes as binary (bytes on the wire are never the envelope)', () => {
      const bytes = new Uint8Array([1, 2, 3]);
      expect(classifyBackupPayload(bytes)).toBe('binary');
    });

    it('round-trips the real envelope codec back to the envelope shape', () => {
      const bytes = buildExportEnvelope([{ id: 1, url: 'https://a.example' }]);
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
        version: number;
        table: string;
      };
      expect(isExportEnvelopePayload(parsed)).toBe(true);
      expect(classifyBackupPayload(parsed)).toBe('envelope');
    });

    it('rejects an envelope with a drifted version or table', () => {
      expect(classifyBackupPayload({ version: 999, table: EXPORT_TABLE })).toBeNull();
      expect(classifyBackupPayload({ version: EXPORT_VERSION, table: 'other_table' })).toBeNull();
    });

    it('classifies the encrypted settings file as settings (codec split stays internal)', () => {
      const file = {
        encrypted: true,
        version: '3',
        exportedAt: '2026-10-24T00:00:00.000Z',
        ciphertext: 'c',
        iv: 'i',
        hmac: 'h',
        salt: 's',
      };
      expect(isEncryptedExport(file)).toBe(true);
      expect(isPlaintextSettingsPayload(file)).toBe(false);
      expect(classifyBackupPayload(file)).toBe('settings');
    });

    it('classifies the plaintext settings file as settings and never as envelope', () => {
      const file = {
        version: SETTINGS_EXPORT_VERSION,
        exportedAt: '2026-10-24T00:00:00.000Z',
        settings: { privacy_mode: 'standard' },
        apiKeyExcluded: true,
      };
      expect(isPlaintextSettingsPayload(file)).toBe(true);
      expect(isEncryptedExport(file)).toBe(false);
      expect(classifyBackupPayload(file)).toBe('settings');
    });

    it('classifies a staging name as archive', () => {
      expect(classifyBackupPayload('staging-2026-10-24')).toBe('archive');
    });

    it('returns null for missing or unrecognized payloads', () => {
      expect(classifyBackupPayload(null)).toBeNull();
      expect(classifyBackupPayload(undefined)).toBeNull();
      expect(classifyBackupPayload({})).toBeNull();
    });
  });

  describe('restoreTargetForShape', () => {
    it('dispatches every shape to its unchanged restore entry point', () => {
      expect(restoreTargetForShape('binary')).toBe('restoreDb');
      expect(restoreTargetForShape('envelope')).toBe('envelopeImport');
      expect(restoreTargetForShape('settings')).toBe('settingsImport');
      expect(restoreTargetForShape('archive')).toBe('archiveRestore');
    });
  });

  describe('capabilities', () => {
    it('passes flags through without re-derivation', () => {
      expect(capabilitiesFromFlags({ supportsBinaryBackup: true, supportsArchive: false })).toEqual({
        supportsBinaryBackup: true,
        supportsArchive: false,
      });
    });

    it('denies the archive capability to a plain backend', () => {
      const backend = { getStatus: async () => ({ success: true }) } as never;
      expect(hasArchiveCapability(backend)).toBe(false);
      expect(supportsArchive(backend)).toBe(false);
    });

    it('grants the archive capability to a staging backend (single rule, both seams agree)', () => {
      const staging = { archiveStatus: async () => ({ success: true }) } as never;
      expect(hasArchiveCapability(staging)).toBe(true);
      expect(supportsArchive(staging)).toBe(true);
    });

    it('derives binary capability from backend status and archive from the probe', async () => {
      const capable = {
        getStatus: async () => ({ success: true, supportsBinaryBackup: true }),
        archiveStatus: async () => ({ success: true }),
      } as never;
      await expect(capabilitiesForBackend(capable)).resolves.toEqual({
        supportsBinaryBackup: true,
        supportsArchive: true,
      });
    });

    it('fails the binary capability closed when status reports an error', async () => {
      const broken = {
        getStatus: async () => ({ success: false, error: 'down' }),
      } as never;
      await expect(capabilitiesForBackend(broken)).resolves.toEqual({
        supportsBinaryBackup: false,
        supportsArchive: false,
      });
    });
  });

  describe('settings generation seam', () => {
    it('detects generation keys by the legacy prefix rule', () => {
      expect(isSettingsBackupKey(`${LEGACY_SETTINGS_BACKUP_KEY}_1729737600000`)).toBe(true);
      expect(isSettingsBackupKey('unrelated_key')).toBe(false);
    });

    it('reports a generation present through the list seam', () => {
      const keys = listSettingsBackupKeys({
        [`${LEGACY_SETTINGS_BACKUP_KEY}_1729737600000`]: { data: {}, createdAt: 1729737600000 },
        other: 1,
      });
      expect(hasSettingsBackupGeneration(keys)).toBe(true);
      expect(hasSettingsBackupGeneration(['other'])).toBe(false);
      expect(hasSettingsBackupGeneration([])).toBe(false);
    });
  });

  describe('dbMaintenance re-export', () => {
    it('exposes the single query through the legacy backup path', () => {
      expect(resolveViaDbMaintenance).toBe(resolveBackupShape);
    });
  });
});
