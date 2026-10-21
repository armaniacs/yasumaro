/**
 * settingsBackupSelectLatest.test.ts
 * PBI 2026-10-21-05: pins the numeric generation order of
 * selectLatestSettingsBackupKey. Production suffixes are 13-digit epoch ms
 * where lexicographic and numeric order agree, so production behavior is
 * unchanged; mixed-length suffixes (test injection, future precision changes)
 * must pick the numerically latest generation, not the lexicographically
 * largest string.
 */
import { describe, it, expect } from 'vitest';
import { LEGACY_SETTINGS_BACKUP_KEY, selectLatestSettingsBackupKey } from '../settingsBackup.js';

function backupKey(suffix: string): string {
    return `${LEGACY_SETTINGS_BACKUP_KEY}_${suffix}`;
}

describe('selectLatestSettingsBackupKey', () => {
    it('picks the numerically latest generation with mixed-length suffixes', () => {
        // Lexicographic order would pick _9, the numerically oldest generation.
        const keys = [backupKey('9'), backupKey('10'), backupKey('100')];
        expect(selectLatestSettingsBackupKey(keys)).toBe(backupKey('100'));
    });

    it('picks the numerically latest 13-digit epoch-ms generation (production shape)', () => {
        const keys = [backupKey('1750000000000'), backupKey('1750000000001')];
        expect(selectLatestSettingsBackupKey(keys)).toBe(backupKey('1750000000001'));
    });

    it('does not depend on the input order', () => {
        const keys = [
            backupKey('99'),
            backupKey('1750000000000'),
            backupKey('7'),
            backupKey('1750000000001'),
        ];
        expect(selectLatestSettingsBackupKey(keys)).toBe(backupKey('1750000000001'));
    });

    it('prefers a suffixed generation over the bare key', () => {
        expect(selectLatestSettingsBackupKey([LEGACY_SETTINGS_BACKUP_KEY, backupKey('1')])).toBe(
            backupKey('1'),
        );
    });

    it('returns the bare key when it is the only backup key', () => {
        expect(selectLatestSettingsBackupKey([LEGACY_SETTINGS_BACKUP_KEY])).toBe(
            LEGACY_SETTINGS_BACKUP_KEY,
        );
    });

    it('ranks a non-numeric suffix older than a real timestamped generation', () => {
        const keys = [backupKey('corrupt'), backupKey('1750000000000')];
        expect(selectLatestSettingsBackupKey(keys)).toBe(backupKey('1750000000000'));
    });

    it('falls back to the lexicographic order among non-numeric suffixes', () => {
        const keys = [backupKey('corrupt'), backupKey('alpha')];
        expect(selectLatestSettingsBackupKey(keys)).toBe(backupKey('corrupt'));
    });

    it('returns the single key for a one-element list', () => {
        expect(selectLatestSettingsBackupKey([backupKey('42')])).toBe(backupKey('42'));
    });

    it('returns null for an empty list', () => {
        expect(selectLatestSettingsBackupKey([])).toBeNull();
    });

    it('does not mutate the input list', () => {
        const keys = [backupKey('9'), backupKey('10')];
        selectLatestSettingsBackupKey(keys);
        expect(keys).toEqual([backupKey('9'), backupKey('10')]);
    });
});
