/**
 * profile-migration.test.ts
 * PBI 2026-11-06-03 統合テスト: Edge・Chrome・Firefox の全9通り
 * (同一ブラウザ別プロファイル3通り + 異ブラウザ6通り) で設定・ログの
 * 移行が成功し、通常経路は拒否し続けること。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogError = vi.hoisted(() => vi.fn(async () => {}));
const mockLogInfo = vi.hoisted(() => vi.fn(async () => {}));
const mockLogWarn = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../src/utils/logger/api.js', () => ({
  logError: mockLogError,
  logInfo: mockLogInfo,
  logWarn: mockLogWarn,
}));

const mockSqliteCall = vi.fn();
vi.mock('../../src/dashboard/dashboardSqliteService.js', () => ({
  sqliteClient: { call: (...args: unknown[]) => mockSqliteCall(...args) },
}));

const { mockShowConfirmDialog } = vi.hoisted(() => ({
  mockShowConfirmDialog: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../src/utils/ui/confirmDialog.js', () => ({
  showConfirmDialog: mockShowConfirmDialog,
}));

import {
  EXPORT_VERSION,
  importSettings,
  importSettingsForMigration,
} from '../../src/utils/settingsExportImport.js';
import type { SettingsImportRepo } from '../../src/utils/settingsExportImport.js';
import {
  importFromJson,
  importFromJsonForMigration,
} from '../../src/dashboard/importLogsService.js';
import { handleMigrationSettingsImport } from '../../src/utils/settingsExportImportUiCore.js';
import { hmacSignerForSecret } from '../../src/utils/crypto/hmacSigner.js';
import { DEFAULT_SETTINGS } from '../../src/utils/storage/defaults.js';
import { API_KEY_FIELDS } from '../../src/utils/storage/settingsMigration.js';
import type { Settings } from '../../src/utils/storage/types.js';

const BROWSERS = ['edge', 'chrome', 'firefox'] as const;
type Browser = (typeof BROWSERS)[number];

function profileSigner(secret: string): ReturnType<typeof hmacSignerForSecret> {
  return hmacSignerForSecret(async () => secret, 'base64');
}

function sanitizedSettings(): Record<string, unknown> {
  const settings: Record<string, unknown> = {
    ...(DEFAULT_SETTINGS as unknown as Record<string, unknown>),
  };
  for (const field of API_KEY_FIELDS) {
    delete settings[field];
  }
  return settings;
}

async function sourceSettingsFile(source: Browser): Promise<string> {
  const signer = profileSigner(`pbi-migration-source-secret-${source}-profile-1`);
  const body = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    settings: sanitizedSettings(),
    apiKeyExcluded: true,
  };
  const signature = await signer.sign(JSON.stringify(body, null, 2));
  return JSON.stringify({ ...body, signature });
}

async function sourceLogsFile(source: Browser): Promise<string> {
  const signer = profileSigner(`pbi-migration-source-secret-${source}-profile-1`);
  const body = {
    version: 2,
    table: 'browsing_logs',
    rows: [{ url: `https://${source}.example.com/page`, created_at: 1700000000000 }],
  };
  const signature = await signer.sign(JSON.stringify(body, null, 2));
  return JSON.stringify({ ...body, signature });
}

function targetRepo(): { repo: SettingsImportRepo; setAll: ReturnType<typeof vi.fn> } {
  const existing = {
    ...(DEFAULT_SETTINGS as unknown as Record<string, unknown>),
    gemini_api_key: 'target-live-key',
  } as Settings;
  const getAll = vi.fn(async () => ({ ...existing }));
  const setAll = vi.fn(async (_patch: Partial<Settings>) => {});
  return { repo: { getAll, setAll } as unknown as SettingsImportRepo, setAll };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockShowConfirmDialog.mockResolvedValue(true);
  mockSqliteCall.mockResolvedValue({ data: { inserted: 1, skipped: 0, total: 1 } });
});

describe('profile migration matrix (PBI 2026-11-06-03)', () => {
  for (const source of BROWSERS) {
    for (const target of BROWSERS) {
      const sameBrowser = source === target;
      const leg = sameBrowser
        ? `same-browser different-profile (${source})`
        : `cross-browser (${source} to ${target})`;

      describe(`settings ${leg}`, () => {
        it('migrates while the normal import keeps rejecting', async () => {
          const json = await sourceSettingsFile(source);
          const { repo, setAll } = targetRepo();
          const targetSigner = profileSigner(
            `pbi-migration-target-secret-${target}-profile-2`
          );

          const migrated = await importSettingsForMigration(json, { repo });
          const normal = await importSettings(json, { repo, signer: targetSigner });

          expect(migrated).not.toBeNull();
          expect(setAll).toHaveBeenCalledTimes(1);
          expect(normal).toBeNull();
        });
      });

      describe(`logs ${leg}`, () => {
        it('migrates while the normal import keeps rejecting', async () => {
          const json = await sourceLogsFile(source);

          const migrated = await importFromJsonForMigration(json);
          const normal = await importFromJson(json);

          expect(migrated).toEqual({ inserted: 1, skipped: 0, total: 1 });
          expect(normal).toEqual({
            error:
              'Log file signature verification failed. The file may be corrupted or was exported from a different browser profile.',
          });
        });
      });
    }
  }

  describe('migration confirmation gate (integration)', () => {
    it('changes nothing when the user cancels the confirmation', async () => {
      mockShowConfirmDialog.mockResolvedValue(false);
      const json = await sourceSettingsFile('edge');
      const { repo, setAll } = targetRepo();
      const file = new File([json], 'edge-settings.json', { type: 'application/json' });
      const ctx = { reloadFn: vi.fn(async () => {}), showStatus: vi.fn() };

      const applied = await handleMigrationSettingsImport(file, ctx, { repo });

      expect(applied).toBe(false);
      expect(setAll).not.toHaveBeenCalled();
      expect(ctx.reloadFn).not.toHaveBeenCalled();
    });

    it('applies the migration and preserves API keys when confirmed', async () => {
      const json = await sourceSettingsFile('firefox');
      const { repo, setAll } = targetRepo();
      const file = new File([json], 'firefox-settings.json', { type: 'application/json' });
      const ctx = { reloadFn: vi.fn(async () => {}), showStatus: vi.fn() };

      const applied = await handleMigrationSettingsImport(file, ctx, { repo });

      expect(applied).toBe(true);
      expect(setAll).toHaveBeenCalledTimes(1);
      const saved = setAll.mock.calls[0]![0] as Record<string, unknown>;
      expect(saved.gemini_api_key).toBe('target-live-key');
      expect(ctx.reloadFn).toHaveBeenCalledTimes(1);
    });
  });
});
