/**
 * @jest-environment jsdom
 */

/**
 * manifest.test.ts
 * Unit tests for manifest.json host permissions minimization
 * TDD Red phase: Tests for minimal host permissions
 *
 * Note: This test validates the configuration state, not implementation behavior.
 * For permission request behavior tests, see cspSettings-permission-request.test.ts
 */

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Manifest - Host Permissions Minimization', () => {
  let manifest: any;

  beforeEach(() => {
    const manifestPath = join(process.cwd(), 'manifest.json');
    const manifestContent = readFileSync(manifestPath, 'utf8');
    manifest = JSON.parse(manifestContent);
  });

  describe('host_permissions', () => {
    it('should be significantly reduced from original 2000+ domains', () => {
      const hostPermissions = manifest.host_permissions;
      expect(hostPermissions).toBeDefined();
      expect(Array.isArray(hostPermissions)).toBe(true);

      // 2000+ドメインから大幅削減（目標: <50、最低: <100）
      expect(hostPermissions.length).toBeLessThan(100);
    });

    it('should contain default AI provider domains', () => {
      const hostPermissions = manifest.host_permissions;

      // デフォルトドメインが含まれていることを確認
      const defaultDomains = [
        'https://api.openai.com/*',
        'https://api.anthropic.com/*',
        'https://api.groq.com/*',
        'https://mistral.ai/*',
        'https://deepseek.com/*',
        'https://generativelanguage.googleapis.com/*'
      ];

      for (const domain of defaultDomains) {
        expect(hostPermissions).toContain(domain);
      }
    });

    it('should not contain additional AI provider domains', () => {
      const hostPermissions = manifest.host_permissions;
      const forbiddenDomains = [
        'api-inference.huggingface.co',
        'api.openrouter.ai',
        'deepinfra.com',
        'cerebras.ai'
      ];

      for (const domain of forbiddenDomains) {
        const hasForbidden = hostPermissions.some((perm: string) => perm.includes(domain));
        expect(hasForbidden).toBe(false);
      }
    });

    it('should contain localhost and 127.0.0.1 permissions', () => {
      const hostPermissions = manifest.host_permissions;
      const localhostDomains = ['localhost', '127.0.0.1'];

      for (const domain of localhostDomains) {
        const hasDomain = hostPermissions.some((perm: string) => perm.includes(domain));
        expect(hasDomain).toBe(true);
      }
    });
  });

  describe('optional_host_permissions', () => {
    it('should contain additional AI provider domains', () => {
      const optionalPermissions = manifest.optional_host_permissions;
      expect(optionalPermissions).toBeDefined();
      expect(Array.isArray(optionalPermissions)).toBe(true);

      // 追加プロバイダーが含まれていることを確認
      const additionalProviders = [
        'api-inference.huggingface.co',
        'api.openrouter.ai',
        'deepinfra.com',
        'cerebras.ai'
      ];

      for (const provider of additionalProviders) {
        const hasProvider = optionalPermissions.some((perm: string) => perm.includes(provider));
        expect(hasProvider).toBe(true);
      }
    });

    it('should contain essential non-AI domains', () => {
      const optionalPermissions = manifest.optional_host_permissions;
      const essentialDomains = [
        'raw.githubusercontent.com',
        'gitlab.com',
        'tranco-list.eu',
        'easylist.to'
      ];

      for (const domain of essentialDomains) {
        const hasDomain = optionalPermissions.some((perm: string) => perm.includes(domain));
        expect(hasDomain).toBe(true);
      }
    });
  });

  describe('Domain count constraints', () => {
    it('should have host_permissions significantly reduced (<30)', () => {
      const hostPermissions = manifest.host_permissions;
      expect(hostPermissions.length).toBeLessThan(30);
    });

    it('should have total permissions less than 100', () => {
      const hostPermissions = manifest.host_permissions;
      const optionalPermissions = manifest.optional_host_permissions;
      const total = hostPermissions.length + optionalPermissions.length;
      expect(total).toBeLessThan(100);
    });
  });
});