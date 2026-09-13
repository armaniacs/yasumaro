// @vitest-environment jsdom
/**
 * perSiteOverrides.test.ts
 * PBI 2026-09-05-24: 空リスト表示が i18n キー経由であることを検証する。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../utils/i18n.js', () => ({
  getMessage: vi.fn((key: string) => key),
}));

vi.mock('../../../utils/storage/SettingsRepository.js', () => ({
  settingsRepository: {
    getAll: vi.fn().mockResolvedValue({}),
    setAll: vi.fn().mockResolvedValue(undefined),
  },
}));

import { initPerSiteOverrides } from '../perSiteOverrides.js';
import { getMessage } from '../../../utils/i18n.js';
import { settingsRepository } from '../../../utils/storage/SettingsRepository.js';

const mockedGetMessage = vi.mocked(getMessage);
const mockedGetAll = vi.mocked(settingsRepository.getAll);

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

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetAll.mockResolvedValue({});
  mockedGetMessage.mockImplementation(((key: string) => key) as typeof getMessage);
  buildDom();
});

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
