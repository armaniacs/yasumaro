/**
 * @jest-environment jsdom
 */

/**
 * cspSettings-permission-request.test.ts
 * Unit tests for CSP permission request functionality
 * TDD Red phase: Tests for Chrome permissions.request() behavior
 */

import { vi } from 'vitest';;

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
    (chrome.permissions.request as vi.Mock).mockResolvedValue(true);
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

      (chrome.permissions.request as vi.Mock).mockResolvedValue(false);

      const granted = await CspSettingsController.requestProviderPermission('huggingface');

      expect(granted).toBe(false);
    });

    it('should handle permission request error', async () => {
      const { CspSettingsController } = await import('../cspSettings.js');

      (chrome.permissions.request as vi.Mock).mockRejectedValue(new Error('Permission denied'));

      const granted = await CspSettingsController.requestProviderPermission('huggingface');

      expect(granted).toBe(false);
    });
  });

  describe('requestEssentialPermission', () => {
    it('should request permission for GitHub Raw Content', async () => {
      const { CspSettingsController } = await import('../cspSettings.js');

      const granted = await CspSettingsController.requestEssentialPermission('github-raw');

      expect(chrome.permissions.request).toHaveBeenCalledWith({
        origins: ['https://raw.githubusercontent.com/*']
      });
      expect(granted).toBe(true);
    });

    it('should request permission for Tranco List', async () => {
      const { CspSettingsController } = await import('../cspSettings.js');

      const granted = await CspSettingsController.requestEssentialPermission('tranco');

      expect(chrome.permissions.request).toHaveBeenCalledWith({
        origins: ['https://tranco-list.eu/*']
      });
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

      (chrome.permissions.contains as vi.Mock).mockResolvedValue(true);

      const hasPermission = await CspSettingsController.hasPermission('huggingface');

      expect(chrome.permissions.contains).toHaveBeenCalledWith({
        origins: ['https://api-inference.huggingface.co/*']
      });
      expect(hasPermission).toBe(true);
    });

    it('should return false if permission not granted', async () => {
      const { CspSettingsController } = await import('../cspSettings.js');

      (chrome.permissions.contains as vi.Mock).mockResolvedValue(false);

      const hasPermission = await CspSettingsController.hasPermission('huggingface');

      expect(hasPermission).toBe(false);
    });
  });
});
