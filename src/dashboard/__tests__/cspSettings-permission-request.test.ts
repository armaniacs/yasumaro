/**
 * @jest-environment jsdom
 */

/**
 * cspSettings-permission-request.test.ts
 * Unit tests for CSP permission request functionality
 * TDD Red phase: Tests for Chrome permissions.request() behavior
 */

import { jest } from '@jest/globals';

// Mock chrome.permissions API
global.chrome = {
  permissions: {
    request: jest.fn(),
    getAll: jest.fn(),
    contains: jest.fn()
  }
} as any;

describe('CSPSettings - Permission Request', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock success response for permission requests
    (chrome.permissions.request as jest.Mock).mockResolvedValue(true);
  });

  describe('requestProviderPermission', () => {
    it('should request permission for HuggingFace provider', async () => {
      const { CSPSettings } = await import('../cspSettings.js');

      const granted = await CSPSettings.requestProviderPermission('huggingface');

      expect(chrome.permissions.request).toHaveBeenCalledWith({
        origins: ['https://api-inference.huggingface.co/*']
      });
      expect(granted).toBe(true);
    });

    it('should return false for unknown provider', async () => {
      const { CSPSettings } = await import('../cspSettings.js');

      const granted = await CSPSettings.requestProviderPermission('unknown_provider');

      expect(chrome.permissions.request).not.toHaveBeenCalled();
      expect(granted).toBe(false);
    });

    it('should handle permission denial', async () => {
      const { CSPSettings } = await import('../cspSettings.js');

      (chrome.permissions.request as jest.Mock).mockResolvedValue(false);

      const granted = await CSPSettings.requestProviderPermission('huggingface');

      expect(granted).toBe(false);
    });

    it('should handle permission request error', async () => {
      const { CSPSettings } = await import('../cspSettings.js');

      (chrome.permissions.request as jest.Mock).mockRejectedValue(new Error('Permission denied'));

      const granted = await CSPSettings.requestProviderPermission('huggingface');

      expect(granted).toBe(false);
    });
  });

  describe('requestEssentialPermission', () => {
    it('should request permission for GitHub Raw Content', async () => {
      const { CSPSettings } = await import('../cspSettings.js');

      const granted = await CSPSettings.requestEssentialPermission('github-raw');

      expect(chrome.permissions.request).toHaveBeenCalledWith({
        origins: ['https://raw.githubusercontent.com/*']
      });
      expect(granted).toBe(true);
    });

    it('should request permission for Tranco List', async () => {
      const { CSPSettings } = await import('../cspSettings.js');

      const granted = await CSPSettings.requestEssentialPermission('tranco');

      expect(chrome.permissions.request).toHaveBeenCalledWith({
        origins: ['https://tranco-list.eu/*']
      });
      expect(granted).toBe(true);
    });

    it('should return false for unknown essential permission', async () => {
      const { CSPSettings } = await import('../cspSettings.js');

      const granted = await CSPSettings.requestEssentialPermission('unknown');

      expect(chrome.permissions.request).not.toHaveBeenCalled();
      expect(granted).toBe(false);
    });
  });

  describe('hasPermission', () => {
    it('should check if permission is granted for provider', async () => {
      const { CSPSettings } = await import('../cspSettings.js');

      (chrome.permissions.contains as jest.Mock).mockResolvedValue(true);

      const hasPermission = await CSPSettings.hasPermission('huggingface');

      expect(chrome.permissions.contains).toHaveBeenCalledWith({
        origins: ['https://api-inference.huggingface.co/*']
      });
      expect(hasPermission).toBe(true);
    });

    it('should return false if permission not granted', async () => {
      const { CSPSettings } = await import('../cspSettings.js');

      (chrome.permissions.contains as jest.Mock).mockResolvedValue(false);

      const hasPermission = await CSPSettings.hasPermission('huggingface');

      expect(hasPermission).toBe(false);
    });
  });
});