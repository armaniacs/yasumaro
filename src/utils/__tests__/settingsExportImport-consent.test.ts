/**
 * settingsExportImport-consent.test.ts — PBI 2026-10-19-12.
 *
 * Runs in the node environment on purpose: the suite has a gated cap on jsdom
 * files (`test-perf` "jsdom files" budget), and the export path only needs
 * `document` / `URL` / `Blob` to be present — the stubs below stand in for them.
 *
 * Consent is an act the data subject performs on *this* device, so a settings
 * file must not carry it: an export would grant consent on the target profile,
 * and a revoked export would withdraw a valid grant there.
 *
 * `privacy_mode` / `pii_confirmation_ui` are excluded too. They are not the
 * consent record, but `migrateLegacyPrivacyConsent` treats them as evidence that
 * privacy features were used before and auto-grants consent — so an imported
 * file would grant consent without the user ever seeing the modal.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLogError = vi.hoisted(() => vi.fn(async () => {}));
const mockLogInfo = vi.hoisted(() => vi.fn(async () => {}));
const mockLogWarn = vi.hoisted(() => vi.fn(async () => {}));
const mockRepoGetAll = vi.hoisted(() => vi.fn(async () => ({})));
const mockRepoSetAll = vi.hoisted(() => vi.fn(async (_patch: Record<string, unknown>) => {}));
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

import { EXPORT_VERSION, exportSettings, importSettings } from '../settingsExportImport.js';
import { exportHmacSigner } from '../storage/encryptionSession.js';
import { DEFAULT_SETTINGS } from '../storage/defaults.js';
import { API_KEY_FIELDS } from '../storage/settingsMigration.js';
import { StorageKeys } from '../storage/types.js';

/** The consent record: never exported, never imported. */
const CONSENT_RECORD_KEYS = [
  StorageKeys.PRIVACY_CONSENT,
  StorageKeys.PRIVACY_CONSENT_VERSION,
  StorageKeys.PRIVACY_CONSENT_DENIED_COUNT,
  StorageKeys.PRIVACY_CONSENT_LAST_DENIAL_TIME,
] as string[];

/**
 * Legacy-migration evidence: still exported (it is ordinary configuration and
 * part of the required-key contract) but ignored on import, so a file cannot
 * make `migrateLegacyPrivacyConsent` grant consent.
 */
const MIGRATION_EVIDENCE_KEYS = [
  StorageKeys.PRIVACY_MODE,
  StorageKeys.PII_CONFIRMATION_UI,
] as string[];

const CONSENT_RECORD: Record<string, unknown> = {
  [StorageKeys.PRIVACY_CONSENT]: {
    granted: true,
    version: '2.0',
    grantedAt: '2026-10-19T00:00:00.000Z',
  },
  [StorageKeys.PRIVACY_CONSENT_VERSION]: '2.0',
  [StorageKeys.PRIVACY_CONSENT_DENIED_COUNT]: 2,
  [StorageKeys.PRIVACY_CONSENT_LAST_DENIAL_TIME]: 1_760_000_000_000,
  [StorageKeys.PRIVACY_MODE]: 'full_pipeline',
  [StorageKeys.PII_CONFIRMATION_UI]: true,
};

function settingsWithConsent(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...(DEFAULT_SETTINGS as Record<string, unknown>), ...CONSENT_RECORD, ...extra };
}

function payload(settings: Record<string, unknown>, apiKeyExcluded: boolean): Record<string, unknown> {
  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
    apiKeyExcluded,
  };
}

async function signedJson(body: Record<string, unknown>): Promise<string> {
  const { signature: _ignored, ...rest } = body;
  const dataJson = JSON.stringify(rest, null, 2);
  const signature = await exportHmacSigner.sign(dataJson);
  return JSON.stringify({ ...rest, signature });
}

/** Capture the exported file content through the Blob/URL/anchor seam. */
function captureExport(): { text: () => string } {
  const written: string[] = [];
  class CapturingBlob {
    constructor(parts: BlobPart[]) {
      written.push(String(parts[0]));
    }
  }
  const link = {
    href: '',
    download: '',
    style: { display: '' },
    click: vi.fn(),
  };
  vi.stubGlobal('Blob', CapturingBlob);
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:captured'),
    revokeObjectURL: vi.fn(),
  });
  vi.stubGlobal('document', {
    createElement: vi.fn(() => link),
    body: { appendChild: vi.fn(), removeChild: vi.fn() },
  });
  return {
    text: () => {
      expect(written).toHaveLength(1);
      return written[0] ?? '';
    },
  };
}

function savedPatch(): Record<string, unknown> {
  expect(mockRepoSetAll).toHaveBeenCalledTimes(1);
  return mockRepoSetAll.mock.calls[0]![0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRepoGetAll.mockResolvedValue({ ...(DEFAULT_SETTINGS as Record<string, unknown>) });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('settings export/import — consent state is device-local', () => {
  it('exportSettings leaves the consent record out of the payload', async () => {
    mockRepoGetAll.mockResolvedValue(settingsWithConsent({ obsidian_host: '127.0.0.1' }));
    const exported = captureExport();

    await exportSettings();

    const parsed = JSON.parse(exported.text()) as { settings: Record<string, unknown> };
    for (const key of CONSENT_RECORD_KEYS) {
      expect(parsed.settings, `export must not carry ${key}`).not.toHaveProperty(key);
    }
    // Unrelated settings still travel, including the privacy mode (it is
    // configuration, and the required-key contract depends on it).
    expect(parsed.settings).toHaveProperty('obsidian_host', '127.0.0.1');
    expect(parsed.settings).toHaveProperty(StorageKeys.PRIVACY_MODE);
  });

  it('importSettings ignores a consent record in the payload', async () => {
    const settings = settingsWithConsent();
    for (const field of API_KEY_FIELDS) {
      delete (settings as Record<string, unknown>)[field];
    }
    const json = await signedJson(payload(settings, true));

    const result = await importSettings(json) as unknown as Record<string, unknown>;

    expect(result).not.toBeNull();
    const saved = savedPatch();
    for (const key of [...CONSENT_RECORD_KEYS, ...MIGRATION_EVIDENCE_KEYS]) {
      expect(result, `import must not restore ${key}`).not.toHaveProperty(key);
      expect(saved, `import must not persist ${key}`).not.toHaveProperty(key);
    }
  });

  it('does not overwrite the target device consent state (round trip)', async () => {
    // Profile A: consented, exports.
    mockRepoGetAll.mockResolvedValue(settingsWithConsent());
    const exported = captureExport();
    await exportSettings();
    const fileFromA = exported.text();

    // Profile B: already granted on its own. Restoring A's backup must not
    // touch that record — neither granting it again nor withdrawing it. The DOM
    // spies stay in place: the import path never touches them, and restoring
    // them would also reset the signing seam this file depends on.
    mockRepoSetAll.mockClear();
    mockRepoGetAll.mockResolvedValue({ ...(DEFAULT_SETTINGS as Record<string, unknown>) });

    const result = await importSettings(fileFromA) as unknown as Record<string, unknown>;

    expect(result).not.toBeNull();
    const saved = savedPatch();
    for (const key of [...CONSENT_RECORD_KEYS, ...MIGRATION_EVIDENCE_KEYS]) {
      expect(saved).not.toHaveProperty(key);
    }
  });
});
