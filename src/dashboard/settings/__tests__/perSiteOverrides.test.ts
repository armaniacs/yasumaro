// @vitest-environment jsdom
/**
 * perSiteOverrides.test.ts
 * PBI 2026-09-05-24: 空リスト表示が i18n キー経由であることを検証する。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../utils/i18n.js', () => {
  const getMessage = vi.fn((key: string) => key);
  const getMessageOr = (key: string, fallback: string, subs?: unknown): string =>
  ((subs === undefined ? (getMessage as (...a: any[]) => unknown)(key) : (getMessage as (...a: any[]) => unknown)(key, subs)) || fallback) as string;
  const getMessageWithSubstitutions = (
  key: string,
  subs: Record<string, string | number>,
  fallback: string,
      ): string =>
      ((getMessage as (...a: any[]) => unknown)(key, subs) ||
  fallback.replace(/\{(\w+)\}/g, (_m: string, n: string) =>
    subs[n] !== undefined ? String(subs[n]) : `{${n}}`)) as string;
  return {
  getMessage: getMessage, getMessageOr, getMessageWithSubstitutions
}; });

vi.mock('../../../utils/storage/SettingsRepository.js', () => ({
  settingsRepository: {
    getAll: vi.fn().mockResolvedValue({}),
    setAll: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../utils/logger/api.js', () => ({
  logError: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../utils/logger/types.js', () => ({
  ErrorCode: { STORAGE_WRITE_FAILURE: 'STRG_WR_001' },
}));

import { initPerSiteOverrides } from '../perSiteOverrides.js';
import { getMessage } from '../../../utils/i18n.js';
import { settingsRepository } from '../../../utils/storage/SettingsRepository.js';
import { StorageKeys } from '../../../utils/storage/types.js';
import { logError } from '../../../utils/logger/api.js';

const mockedGetMessage = vi.mocked(getMessage);
const mockedGetAll = vi.mocked(settingsRepository.getAll);
const mockedSetAll = vi.mocked(settingsRepository.setAll);
const mockedLogError = vi.mocked(logError);

function buildDom(): void {
  document.body.innerHTML = `
    <input id="perSiteOverrideDomain" />
    <div id="perSiteOverrideToggles"></div>
    <button id="perSiteOverrideSaveBtn"></button>
    <button id="perSiteOverrideDeleteBtn"></button>
    <div id="perSiteOverrideStatus"></div>
    <div id="perSiteOverrideList"></div>
  `;
}

const chromeSetMock = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetAll.mockResolvedValue({});
  mockedSetAll.mockResolvedValue(undefined);
  mockedGetMessage.mockImplementation(((key: string) => key) as typeof getMessage);
  chromeSetMock.mockResolvedValue(undefined);
  (globalThis as unknown as Record<string, unknown>).chrome = {
    storage: { local: { set: chromeSetMock } },
  };
  buildDom();
});

async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function statusText(): string {
  return document.getElementById('perSiteOverrideStatus')!.textContent ?? '';
}

describe('perSiteOverrides — 空リスト表示の i18n', () => {
  it('references the noPerSiteOverrides key when there are no overrides', async () => {
    initPerSiteOverrides();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockedGetMessage).toHaveBeenCalledWith('noPerSiteOverrides');
    expect(document.getElementById('perSiteOverrideList')!.textContent).toBe('noPerSiteOverrides');
  });

  it('shows the English fallback when the key is missing (keeps legacy English display)', async () => {
    mockedGetMessage.mockReturnValue('' as unknown as string);
    initPerSiteOverrides();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.getElementById('perSiteOverrideList')!.textContent).toBe('No per-site overrides.');
  });
});

describe('perSiteOverrides — pinned observable storage behavior (PBI 2026-09-21-02)', () => {
  it('save persists the upserted entry as a repository delta under DOMAIN_CLEANSING_OVERRIDES', async () => {
    initPerSiteOverrides();
    await flush();
    (document.getElementById('perSiteOverrideDomain') as HTMLInputElement).value = 'example.com';
    (document.getElementById('per-site-override-alt') as HTMLInputElement).checked = true;
    (document.getElementById('perSiteOverrideSaveBtn') as HTMLButtonElement).click();
    await flush();

    expect(mockedSetAll).toHaveBeenCalledTimes(1);
    const delta = mockedSetAll.mock.calls[0]![0] as Record<string, unknown>;
    const stored = delta[StorageKeys.DOMAIN_CLEANSING_OVERRIDES] as Array<{
      domain: string;
      overrides: Record<string, unknown>;
    }>;
    expect(stored).toHaveLength(1);
    expect(stored[0]!.domain).toBe('example.com');
    expect(stored[0]!.overrides['altEnabled']).toBe(true);
    expect(statusText()).toBe('Saved');
  });

  it('delete persists the removal as a repository delta under DOMAIN_CLEANSING_OVERRIDES', async () => {
    mockedGetAll.mockResolvedValue({
      [StorageKeys.DOMAIN_CLEANSING_OVERRIDES]: [
        { domain: 'example.com', overrides: { altEnabled: true } },
      ],
    });
    initPerSiteOverrides();
    await flush();
    (document.getElementById('perSiteOverrideDomain') as HTMLInputElement).value = 'example.com';
    (document.getElementById('perSiteOverrideDeleteBtn') as HTMLButtonElement).click();
    await flush();

    expect(mockedSetAll).toHaveBeenCalledTimes(1);
    const delta = mockedSetAll.mock.calls[0]![0] as Record<string, unknown>;
    expect(delta[StorageKeys.DOMAIN_CLEANSING_OVERRIDES]).toEqual([]);
    expect(statusText()).toBe('Deleted');
  });

  it('reader path: overrides listed from the repository settings object (contentKernel key)', async () => {
    mockedGetAll.mockResolvedValue({
      [StorageKeys.DOMAIN_CLEANSING_OVERRIDES]: [
        { domain: 'example.com', overrides: { altEnabled: true } },
      ],
    });
    initPerSiteOverrides();
    await flush();

    expect(document.getElementById('perSiteOverrideList')!.textContent).toContain('example.com');
  });
});

describe('perSiteOverrides — single writer + failure visibility (PBI 2026-09-21-02)', () => {
  function statusClass(): string {
    return document.getElementById('perSiteOverrideStatus')!.className;
  }

  it('save writes only through the repository lock, never via direct chrome.storage.local.set', async () => {
    initPerSiteOverrides();
    await flush();
    (document.getElementById('perSiteOverrideDomain') as HTMLInputElement).value = 'example.com';
    (document.getElementById('per-site-override-alt') as HTMLInputElement).checked = true;
    (document.getElementById('perSiteOverrideSaveBtn') as HTMLButtonElement).click();
    await flush();

    expect(mockedSetAll).toHaveBeenCalledTimes(1);
    expect(chromeSetMock).not.toHaveBeenCalled();
    expect(statusText()).toBe('Saved');
    expect(statusClass()).toContain('success');
    expect(mockedLogError).not.toHaveBeenCalled();
  });

  it('save failure shows an error status and structured log instead of Saved', async () => {
    mockedSetAll.mockRejectedValueOnce(new Error('quota exceeded'));
    initPerSiteOverrides();
    await flush();
    (document.getElementById('perSiteOverrideDomain') as HTMLInputElement).value = 'example.com';
    (document.getElementById('per-site-override-alt') as HTMLInputElement).checked = true;
    (document.getElementById('perSiteOverrideSaveBtn') as HTMLButtonElement).click();
    await flush();

    expect(statusText()).not.toBe('Saved');
    expect(statusText()).toBe('settingsSaveError');
    expect(statusClass()).toContain('error');
    expect(mockedLogError).toHaveBeenCalledTimes(1);
    expect(chromeSetMock).not.toHaveBeenCalled();
  });

  it('delete writes only through the repository lock, never via direct chrome.storage.local.set', async () => {
    mockedGetAll.mockResolvedValue({
      [StorageKeys.DOMAIN_CLEANSING_OVERRIDES]: [
        { domain: 'example.com', overrides: { altEnabled: true } },
      ],
    });
    initPerSiteOverrides();
    await flush();
    (document.getElementById('perSiteOverrideDomain') as HTMLInputElement).value = 'example.com';
    (document.getElementById('perSiteOverrideDeleteBtn') as HTMLButtonElement).click();
    await flush();

    expect(mockedSetAll).toHaveBeenCalledTimes(1);
    expect(chromeSetMock).not.toHaveBeenCalled();
    expect(statusText()).toBe('Deleted');
    expect(mockedLogError).not.toHaveBeenCalled();
  });

  it('delete failure shows an error status and structured log instead of Deleted', async () => {
    mockedGetAll.mockResolvedValue({
      [StorageKeys.DOMAIN_CLEANSING_OVERRIDES]: [
        { domain: 'example.com', overrides: { altEnabled: true } },
      ],
    });
    mockedSetAll.mockRejectedValueOnce(new Error('quota exceeded'));
    initPerSiteOverrides();
    await flush();
    (document.getElementById('perSiteOverrideDomain') as HTMLInputElement).value = 'example.com';
    (document.getElementById('perSiteOverrideDeleteBtn') as HTMLButtonElement).click();
    await flush();

    expect(statusText()).not.toBe('Deleted');
    expect(statusText()).toBe('settingsSaveError');
    expect(statusClass()).toContain('error');
    expect(mockedLogError).toHaveBeenCalledTimes(1);
    expect(chromeSetMock).not.toHaveBeenCalled();
  });
});
