/**
 * settingsExportImport-sizeBytes.test.ts
 * PBI 2026-10-16-04 (a): サイズ上限はバイト換算で判定されること。
 * `jsonData.length` (UTF-16 単位) と `DEFAULT_IMPORT_SIZE_CAP_BYTES`
 * (バイト) の直接比較では、非ASCII 多用のファイルが素通しする。
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

// 文字数では上限内だがバイト数では上限超になる入力を作るため、小さな上限に差し替える。
vi.mock('../importPipeline.js', () => ({
  DEFAULT_IMPORT_SIZE_CAP_BYTES: 100,
}));

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

import { importEncryptedSettings, importSettings } from '../settingsExportImport.js';

function sizeCapRejections(): unknown[] {
  return mockLogError.mock.calls
    .map((call) => (call as unknown[])[0])
    .filter((message) => message === 'Import rejected: file exceeds size cap');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('settingsExportImport size cap (bytes)', () => {
  it('importSettings: 文字数では上限内・バイト数では上限超の入力をサイズ超過で拒否する', async () => {
    // 40文字だが UTF-8 で120バイト (> 上限100バイト)。
    // 文字数比較のままでは素通しして JSON.parse 失敗の別メッセージになる。
    const jsonData = 'あ'.repeat(40);
    expect(jsonData.length).toBeLessThanOrEqual(100);
    expect(new TextEncoder().encode(jsonData).length).toBeGreaterThan(100);

    const result = await importSettings(jsonData);

    expect(result).toBeNull();
    expect(sizeCapRejections()).toHaveLength(1);
  });

  it('importEncryptedSettings: 文字数では上限内・バイト数では上限超の入力をKDF前にサイズ超過で拒否する', async () => {
    const jsonData = 'あ'.repeat(40);
    expect(jsonData.length).toBeLessThanOrEqual(100);
    expect(new TextEncoder().encode(jsonData).length).toBeGreaterThan(100);

    const result = await importEncryptedSettings(jsonData, 'master_password');

    expect(result).toBeNull();
    expect(sizeCapRejections()).toHaveLength(1);
  });

  it('importSettings: バイト数でも上限内のASCII入力はサイズ超過扱いしない', async () => {
    const result = await importSettings('not json');

    expect(result).toBeNull();
    expect(sizeCapRejections()).toHaveLength(0);
  });
});
