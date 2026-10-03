// @vitest-environment jsdom
/**
 * Pins the import/restore reload seam: exportImport.ts and
 * encryptedBackupPanel.ts announce completion by dispatching the
 * 'reload-general-settings' document event, and this panel must listen and
 * reload its general/provider inputs (plus the snapshot the layout toggle
 * reads). A reload failure must be contained so the dispatching flow's own
 * completion status stays intact.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { waitForMock } from '../../../../../testDir/waitPolicy.js';

const { mockGetAll, mockPortGet, mockSet } = vi.hoisted(() => ({
  mockGetAll: vi.fn(),
  mockPortGet: vi.fn(),
  mockSet: vi.fn(),
}));

vi.mock('../../../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    settingsRepository: {
      getAll: mockGetAll,
      set: mockSet,
      getPort: () => ({ get: mockPortGet }),
    },
  };
});

import { createGeneralSettingsPanel } from '../generalSettingsPanel.js';
import { StorageKeys } from '../../../../utils/storage/types.js';

const PANEL_MARKUP = `
  <div id="panel-general">
    <input data-storage-key="obsidian_protocol" />
    <input data-storage-key="provider_base_url" />
  </div>`;

async function mountPanel(): Promise<void> {
  const panel = createGeneralSettingsPanel();
  await panel.mount(document.getElementById('panel-general')!);
}

beforeEach(() => {
  document.body.innerHTML = PANEL_MARKUP;
  mockGetAll.mockReset();
  mockGetAll.mockResolvedValue({});
  mockSet.mockReset();
  mockSet.mockResolvedValue(undefined);
  // Seeded so resolveInitialLayout reads layout 'a' from raw storage and skips
  // its new-user write path.
  mockPortGet.mockReset();
  mockPortGet.mockResolvedValue({ settings: { [StorageKeys.AI_PROVIDER_LAYOUT]: 'a' } });
});

describe('generalSettingsPanel — reload-general-settings wiring', () => {
  it('syncs general/provider inputs after the import completion event', async () => {
    mockGetAll.mockResolvedValueOnce({
      [StorageKeys.OBSIDIAN_PROTOCOL]: 'https',
      [StorageKeys.PROVIDER_BASE_URL]: 'http://old-host:8080',
    });
    await mountPanel();
    const protocol = document.querySelector('[data-storage-key="obsidian_protocol"]') as HTMLInputElement;
    const providerBaseUrl = document.querySelector('[data-storage-key="provider_base_url"]') as HTMLInputElement;
    expect(protocol.value).toBe('https');
    expect(providerBaseUrl.value).toBe('http://old-host:8080');

    mockGetAll.mockResolvedValue({
      [StorageKeys.OBSIDIAN_PROTOCOL]: 'http',
      [StorageKeys.PROVIDER_BASE_URL]: 'http://new-host:9999',
    });
    document.dispatchEvent(new CustomEvent('reload-general-settings'));

    await waitForMock(() => {
      expect(protocol.value).toBe('http');
      expect(providerBaseUrl.value).toBe('http://new-host:9999');
    });
  });

  it('contains a reload failure so the dispatching flow stays intact', async () => {
    await mountPanel();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockGetAll.mockRejectedValue(new Error('storage down'));
    expect(() => document.dispatchEvent(new CustomEvent('reload-general-settings'))).not.toThrow();

    await waitForMock(() =>
      expect(errorSpy).toHaveBeenCalledWith('General settings: reload after import/restore failed', expect.any(Error)),
    );
    errorSpy.mockRestore();
  });

  it('refresh() re-reads the repository into the mounted inputs', async () => {
    mockGetAll.mockResolvedValueOnce({});
    const panel = createGeneralSettingsPanel();
    await panel.mount(document.getElementById('panel-general')!);

    mockGetAll.mockResolvedValue({ [StorageKeys.OBSIDIAN_PROTOCOL]: 'http' });
    await panel.refresh?.();

    const protocol = document.querySelector('[data-storage-key="obsidian_protocol"]') as HTMLInputElement;
    expect(protocol.value).toBe('http');
  });
});
