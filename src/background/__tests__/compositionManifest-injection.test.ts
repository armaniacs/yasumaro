import { describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createBackgroundServices } from '../createBackgroundServices.js';
import { compositionManifest } from '../compositionManifest.js';
import { ServiceContainer } from '../serviceContainer.js';
import type { Settings } from '../../utils/storage/types.js';

vi.mock('../../utils/storage/privacyConsent.js', () => ({
  hasPrivacyConsent: vi.fn().mockResolvedValue(true),
}));

describe('compositionManifest injected settings', () => {
  describe('recordingAdmission', () => {
    it('reads settings through the container repository instead of the import', async () => {
      const sentinel = { marker: 'injected-settings' } as unknown as Settings;
      const fakeRepository = {
        getAll: vi.fn().mockResolvedValue(sentinel),
        clearCache: vi.fn(),
      };
      const container = new ServiceContainer();
      for (const entry of compositionManifest) {
        // Keep recordingAdmission real so its wiring is exercised; everything
        // else is faked so no real factory (or chrome) is needed.
        if (entry.key === 'recordingAdmission' || entry.key === 'settingsRepository') continue;
        container.override(entry.key, { fake: entry.key });
      }
      container.override('settingsRepository', fakeRepository);
      container.override('rateLimiter', { check: vi.fn().mockResolvedValue({ allowed: true }) });

      const services = createBackgroundServices(container);

      const outcome = await services.recordingAdmission.admit('save', {} as chrome.runtime.MessageSender);

      expect(fakeRepository.getAll).toHaveBeenCalled();
      expect(outcome).toEqual({ settings: sentinel });
    });
  });

  describe('injection seam', () => {
    it('never calls the imported settingsRepository directly for reads or cache clears', async () => {
      // recordingAdmission.getSettings, messageRouter.getSettings, and
      // messageRouter.clearSettingsCache must all resolve through the
      // container so overrides are observed; the only direct reference left
      // is the settingsRepository entry factory itself.
      const src = await readFile(new URL('../compositionManifest.ts', import.meta.url), 'utf8');

      expect(src).not.toMatch(/settingsRepository\.(getAll|clearCache)/);
    });
  });
});
