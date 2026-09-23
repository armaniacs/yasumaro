// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetAll, mockShowConfirmDialog } = vi.hoisted(() => ({
  mockGetAll: vi.fn(),
  mockShowConfirmDialog: vi.fn(async () => true),
}));

vi.mock('../../utils/storage/SettingsRepository.js', () => ({
  settingsRepository: { getAll: mockGetAll },
}));

vi.mock('../../utils/ui/confirmDialog.js', () => ({
  showConfirmDialog: mockShowConfirmDialog,
}));

import { confirmNewProviderBaseUrls } from '../providerOriginConfirmation.js';
import { StorageKeys, type Settings } from '../../utils/storage/types.js';

describe('confirmNewProviderBaseUrls — provider origin confirmation flow (VULN-002)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockShowConfirmDialog.mockResolvedValue(true);
  });

  it('returns noop when the delta carries no provider base URL', async () => {
    mockGetAll.mockResolvedValue({});
    const delta: Partial<Settings> = { ai_provider: 'gemini' };
    expect(await confirmNewProviderBaseUrls(delta)).toBe('noop');
    expect(mockShowConfirmDialog).not.toHaveBeenCalled();
  });

  it('returns noop when the base URL is unchanged from saved settings', async () => {
    mockGetAll.mockResolvedValue({ provider_base_url: 'https://known.example/v1' });
    const delta: Partial<Settings> = { provider_base_url: 'https://known.example/v1' };
    expect(await confirmNewProviderBaseUrls(delta)).toBe('noop');
    expect(mockShowConfirmDialog).not.toHaveBeenCalled();
  });

  it('returns noop for loopback origins (local-provider exception)', async () => {
    mockGetAll.mockResolvedValue({});
    const delta: Partial<Settings> = { lm_studio_base_url: 'http://localhost:1234/v1' };
    expect(await confirmNewProviderBaseUrls(delta)).toBe('noop');
    expect(mockShowConfirmDialog).not.toHaveBeenCalled();
  });

  it('records the confirmed origin into the delta after the user allows', async () => {
    mockGetAll.mockResolvedValue({});
    const delta: Partial<Settings> = { provider_base_url: 'https://new-endpoint.example/v1' };

    expect(await confirmNewProviderBaseUrls(delta)).toBe('confirmed');
    expect(mockShowConfirmDialog).toHaveBeenCalledTimes(1);
    expect(delta[StorageKeys.CONFIRMED_PROVIDER_ORIGINS]).toEqual({
      provider_base_url: ['https://new-endpoint.example'],
    });
  });

  it('merges the new origin into existing confirmations without duplicates', async () => {
    mockGetAll.mockResolvedValue({
      [StorageKeys.CONFIRMED_PROVIDER_ORIGINS]: {
        provider_base_url: ['https://already-confirmed.example'],
      },
    });
    const delta: Partial<Settings> = { provider_base_url: 'https://new-endpoint.example/v1' };

    expect(await confirmNewProviderBaseUrls(delta)).toBe('confirmed');
    expect(delta[StorageKeys.CONFIRMED_PROVIDER_ORIGINS]?.provider_base_url).toEqual([
      'https://already-confirmed.example',
      'https://new-endpoint.example',
    ]);
  });

  it('returns cancelled without touching the delta when the user declines', async () => {
    mockShowConfirmDialog.mockResolvedValue(false);
    mockGetAll.mockResolvedValue({});
    const delta: Partial<Settings> = { provider_base_url: 'https://new-endpoint.example/v1' };

    expect(await confirmNewProviderBaseUrls(delta)).toBe('cancelled');
    expect(delta[StorageKeys.CONFIRMED_PROVIDER_ORIGINS]).toBeUndefined();
  });

  it('skips the dialog for pinned domains', async () => {
    mockGetAll.mockResolvedValue({});
    const delta: Partial<Settings> = { openai_base_url: 'https://api.openai.com/v1' };
    expect(await confirmNewProviderBaseUrls(delta)).toBe('noop');
    expect(mockShowConfirmDialog).not.toHaveBeenCalled();
  });
});
