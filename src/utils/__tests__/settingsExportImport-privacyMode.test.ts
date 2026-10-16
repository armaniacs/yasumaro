/**
 * settingsExportImport-privacyMode.test.ts
 * PBI 2026-10-16-08: an unknown `privacy_mode` is rejected fail-closed AND
 * with a diagnosable reason (field + offending-value info recorded via logError).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLogError = vi.hoisted(() => vi.fn(async () => {}));
const mockLogInfo = vi.hoisted(() => vi.fn(async () => {}));
const mockLogWarn = vi.hoisted(() => vi.fn(async () => {}));
const mockRepoGetAll = vi.hoisted(() => vi.fn(async () => ({})));
const mockRepoSetAll = vi.hoisted(() => vi.fn(async () => {}));
const mockSigner = vi.hoisted(() => {
  const sign = async (data: string) => `test-sig:${data}`;
  return {
    sign: vi.fn(sign),
    verify: vi.fn(async (data: string, sig: string) => sig === (await sign(data))),
  };
});

vi.mock('../logger/api.js', () => ({
  logError: mockLogError,
  logInfo: mockLogInfo,
  logWarn: mockLogWarn,
}));

vi.mock('../storage/SettingsRepository.js', () => ({
  settingsRepository: { getAll: mockRepoGetAll, setAll: mockRepoSetAll },
}));

vi.mock('../storage/encryptionSession.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, exportHmacSigner: mockSigner };
});

import {
  EXPORT_VERSION,
  LEGACY_EXPORT_VERSION,
  getExportValidationError,
  importSettings,
  validateExportData,
} from '../settingsExportImport.js';
import { exportHmacSigner } from '../storage/encryptionSession.js';
import { DEFAULT_SETTINGS } from '../storage/defaults.js';
import { API_KEY_FIELDS } from '../storage/settingsMigration.js';
import { PRIVACY_MODES } from '../storage/types.js';

function validSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const settings: Record<string, unknown> = { ...(DEFAULT_SETTINGS as Record<string, unknown>) };
  for (const field of API_KEY_FIELDS) {
    delete settings[field];
  }
  return { ...settings, ...overrides };
}

function exportPayload(
  settings: Record<string, unknown>,
  version: string = EXPORT_VERSION,
): Record<string, unknown> {
  return {
    version,
    exportedAt: new Date().toISOString(),
    settings,
    apiKeyExcluded: true,
  };
}

async function signedJson(payload: Record<string, unknown>): Promise<string> {
  const { signature: _ignored, ...rest } = payload;
  const dataJson = JSON.stringify(rest, null, 2);
  const signature = await exportHmacSigner.sign(dataJson);
  return JSON.stringify({ ...rest, signature });
}

function loggedValidationDetails(): Record<string, unknown>[] {
  return mockLogError.mock.calls.map((call) => (call as unknown[])[1] as Record<string, unknown>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRepoGetAll.mockResolvedValue({ ...(DEFAULT_SETTINGS as Record<string, unknown>) });
});

describe('settingsExportImport-privacyMode', () => {
  describe('getExportValidationError', () => {
    it('returns null for a valid payload', () => {
      expect(getExportValidationError(exportPayload(validSettings()))).toBeNull();
      expect(validateExportData(exportPayload(validSettings()))).toBe(true);
    });

    it('accepts every known privacy mode', () => {
      for (const mode of PRIVACY_MODES) {
        expect(
          getExportValidationError(exportPayload(validSettings({ privacy_mode: mode }))),
          `mode "${mode}" must stay importable`,
        ).toBeNull();
      }
    });

    it('identifies an unknown privacy_mode with field and value info', () => {
      const error = getExportValidationError(
        exportPayload(validSettings({ privacy_mode: 'super_private_future' })),
      );

      expect(error).not.toBeNull();
      expect(error?.field).toBe('settings.privacy_mode');
      expect(error?.reason).toBe('unknown_privacy_mode');
      expect(error?.receivedType).toBe('string');
      expect(error?.receivedLength).toBe('super_private_future'.length);
      expect(error?.receivedPreview).toBe('super_private_future');
      expect(error?.exportVersion).toBe(EXPORT_VERSION);
      expect(error?.isUnrecognizedVersion).toBe(false);
      // fail-closed: the boolean gate still rejects
      expect(
        validateExportData(exportPayload(validSettings({ privacy_mode: 'super_private_future' }))),
      ).toBe(false);
    });

    it('truncates long offending values to a safe preview', () => {
      const longValue = 'x'.repeat(200);
      const error = getExportValidationError(
        exportPayload(validSettings({ privacy_mode: longValue })),
      );

      expect(error?.reason).toBe('unknown_privacy_mode');
      expect(error?.receivedLength).toBe(200);
      expect(error?.receivedPreview).toBe('x'.repeat(64));
    });

    it('reports non-string privacy_mode values by type without a preview', () => {
      const error = getExportValidationError(
        exportPayload(validSettings({ privacy_mode: 42 })),
      );

      expect(error?.reason).toBe('unknown_privacy_mode');
      expect(error?.receivedType).toBe('number');
      expect(error?.receivedPreview).toBeUndefined();
      expect(error?.receivedLength).toBeUndefined();
    });

    it('flags an unrecognized version stamp so future values read as future', () => {
      const error = getExportValidationError(
        exportPayload(validSettings({ privacy_mode: 'future_mode' }), '9.9.9'),
      );

      expect(error?.reason).toBe('unknown_privacy_mode');
      expect(error?.exportVersion).toBe('9.9.9');
      expect(error?.isUnrecognizedVersion).toBe(true);
    });

    it('treats the same unknown value under a legacy stamp as corruption', () => {
      const error = getExportValidationError(
        exportPayload(validSettings({ privacy_mode: 'future_mode' }), LEGACY_EXPORT_VERSION),
      );

      expect(error?.reason).toBe('unknown_privacy_mode');
      expect(error?.exportVersion).toBe(LEGACY_EXPORT_VERSION);
      expect(error?.isUnrecognizedVersion).toBe(false);
    });

    it('identifies missing required keys by field name', () => {
      const settings = validSettings();
      delete settings['privacy_mode'];

      const error = getExportValidationError(exportPayload(settings));

      expect(error?.field).toBe('settings.privacy_mode');
      expect(error?.reason).toBe('missing_required_key');
    });
  });

  describe('importSettings', () => {
    it('rejects an unknown privacy_mode and records field and value info', async () => {
      const json = await signedJson(
        exportPayload(validSettings({ privacy_mode: 'super_private_future' })),
      );

      const result = await importSettings(json);

      expect(result).toBeNull();
      const details = loggedValidationDetails().find(
        (entry) => entry['field'] === 'settings.privacy_mode',
      );
      expect(details).toMatchObject({
        field: 'settings.privacy_mode',
        reason: 'unknown_privacy_mode',
        receivedType: 'string',
        receivedPreview: 'super_private_future',
      });
    });

    it('restores a valid backup unchanged', async () => {
      const json = await signedJson(exportPayload(validSettings()));

      const result = await importSettings(json);

      expect(result).not.toBeNull();
      expect(mockRepoSetAll).toHaveBeenCalled();
    });
  });
});
