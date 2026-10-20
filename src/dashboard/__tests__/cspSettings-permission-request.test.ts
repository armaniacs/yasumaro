/**
 * @jest-environment jsdom
 */

/**
 * cspSettings-permission-request.test.ts
 * Unit tests for CSP permission request functionality
 * TDD Red phase: Tests for Chrome permissions.request() behavior
 */

import { vi } from 'vitest';;
import type { Mock } from 'vitest';
import { OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS } from '../../utils/cspDomains.js';

// Mock chrome.permissions API
global.chrome = {
  permissions: {
    request: vi.fn(),
    getAll: vi.fn(),
    contains: vi.fn()
  }
} as any;

describe('CspSettingsController - Permission Request', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock success response for permission requests
    (chrome.permissions.request as Mock).mockResolvedValue(true);
  });

  describe('requestProviderPermission', () => {
    it('should request permission for HuggingFace provider', async () => {
      const { CspSettingsController } = await import('../cspSettings.js');

      const granted = await CspSettingsController.requestProviderPermission('huggingface');

      expect(chrome.permissions.request).toHaveBeenCalledWith({
        origins: ['https://api-inference.huggingface.co/*']
      });
      expect(granted).toBe(true);
    });

    it('should return false for unknown provider', async () => {
      const { CspSettingsController } = await import('../cspSettings.js');

      const granted = await CspSettingsController.requestProviderPermission('unknown_provider');

      expect(chrome.permissions.request).not.toHaveBeenCalled();
      expect(granted).toBe(false);
    });

    it('should handle permission denial', async () => {
      const { CspSettingsController } = await import('../cspSettings.js');

      (chrome.permissions.request as Mock).mockResolvedValue(false);

      const granted = await CspSettingsController.requestProviderPermission('huggingface');

      expect(granted).toBe(false);
    });

    it('should handle permission request error', async () => {
      const { CspSettingsController } = await import('../cspSettings.js');

      (chrome.permissions.request as Mock).mockRejectedValue(new Error('Permission denied'));

      const granted = await CspSettingsController.requestProviderPermission('huggingface');

      expect(granted).toBe(false);
    });
  });

  describe('requestEssentialPermission', () => {
    it('should request the GitHub Raw origin from the optional permissions SSOT', async () => {
      const { CspSettingsController } = await import('../cspSettings.js');

      const granted = await CspSettingsController.requestEssentialPermission('github-raw');

      // The origin must be selected from OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS
      // (SSOT-derived from listSources.ts), not a hand-copied literal in
      // cspSettings.ts — a drifted duplicate must fail this assertion.
      expect(chrome.permissions.request).toHaveBeenCalledTimes(1);
      const requested = (chrome.permissions.request as Mock).mock.calls[0]![0] as { origins: string[] };
      expect(requested.origins).toHaveLength(1);
      const [origin] = requested.origins;
      expect(OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS).toContain(origin);
      expect(origin.startsWith('https://raw.githubusercontent.com/')).toBe(true);
      expect(granted).toBe(true);
    });

    it('should request the Tranco List origin from the optional permissions SSOT', async () => {
      const { CspSettingsController } = await import('../cspSettings.js');

      const granted = await CspSettingsController.requestEssentialPermission('tranco');

      expect(chrome.permissions.request).toHaveBeenCalledTimes(1);
      const requested = (chrome.permissions.request as Mock).mock.calls[0]![0] as { origins: string[] };
      expect(requested.origins).toHaveLength(1);
      const [origin] = requested.origins;
      expect(OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS).toContain(origin);
      expect(origin.startsWith('https://tranco-list.eu/')).toBe(true);
      expect(granted).toBe(true);
    });

    it('should return false for unknown essential permission', async () => {
      const { CspSettingsController } = await import('../cspSettings.js');

      const granted = await CspSettingsController.requestEssentialPermission('unknown');

      expect(chrome.permissions.request).not.toHaveBeenCalled();
      expect(granted).toBe(false);
    });
  });

  describe('hasPermission', () => {
    it('should check if permission is granted for provider', async () => {
      const { CspSettingsController } = await import('../cspSettings.js');

      (chrome.permissions.contains as Mock).mockResolvedValue(true);

      const hasPermission = await CspSettingsController.hasPermission('huggingface');

      expect(chrome.permissions.contains).toHaveBeenCalledWith({
        origins: ['https://api-inference.huggingface.co/*']
      });
      expect(hasPermission).toBe(true);
    });

    it('should return false if permission not granted', async () => {
      const { CspSettingsController } = await import('../cspSettings.js');

      (chrome.permissions.contains as Mock).mockResolvedValue(false);

      const hasPermission = await CspSettingsController.hasPermission('huggingface');

      expect(hasPermission).toBe(false);
    });
  });
});
