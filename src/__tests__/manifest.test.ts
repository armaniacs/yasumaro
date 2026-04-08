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
import { readFileSync, existsSync } from 'fs';
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

  describe('web_accessible_resources', () => {
    /**
     * content/extractor.js から始まる import チェーンを再帰的に解決し、
     * utils/*.js の全依存ファイルが web_accessible_resources に登録されているかを検証する。
     *
     * このテストは「contentDeduplicator.js を web_accessible_resources に追加し忘れた」
     * ようなミスを防ぐためのリグレッションテスト。
     */
    function collectImports(filePath: string, visited = new Set<string>()): Set<string> {
      if (visited.has(filePath)) return visited;
      if (!existsSync(filePath)) return visited;

      visited.add(filePath);
      const content = readFileSync(filePath, 'utf8');

      // import { ... } from './foo.js' または import { ... } from '../utils/foo.js' の形式を解析
      const importRegex = /^import\s+.*?\s+from\s+['"]([^'"]+)['"]/gm;
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        const importPath = match[1];
        // 相対パスのみ追跡
        if (!importPath.startsWith('.')) continue;

        const dir = filePath.substring(0, filePath.lastIndexOf('/'));
        const resolved = join(dir, importPath).replace(/\\/g, '/');
        collectImports(resolved, visited);
      }
      return visited;
    }

    function getWebAccessibleResources(manifest: any): string[] {
      const resources: string[] = [];
      for (const entry of manifest.web_accessible_resources ?? []) {
        resources.push(...(entry.resources ?? []));
      }
      return resources;
    }

    it('content/extractor.js の全 import チェーンが web_accessible_resources に登録されている', () => {
      const distDir = join(process.cwd(), 'dist');
      const entryPoint = join(distDir, 'content/extractor.js');

      if (!existsSync(entryPoint)) {
        // dist/ がない場合（CI初回など）はスキップ
        console.warn('dist/content/extractor.js not found — run npm run build first');
        return;
      }

      const allFiles = collectImports(entryPoint);
      const accessible = getWebAccessibleResources(manifest);

      // dist/ 以下の相対パスに変換して検証
      const missing: string[] = [];
      for (const absPath of allFiles) {
        if (!absPath.startsWith(distDir)) continue;
        const rel = absPath.replace(distDir + '/', '');
        // content/ エントリ自体は対象外（extractor.js 自身は登録済み確認済み）
        // utils/*.js のみ検証対象
        if (!rel.startsWith('utils/')) continue;
        if (!accessible.includes(rel)) {
          missing.push(rel);
        }
      }

      expect(missing).toEqual([]);
    });

    it('web_accessible_resources に登録された utils/*.js が dist/ に実際に存在する', () => {
      const distDir = join(process.cwd(), 'dist');
      if (!existsSync(distDir)) {
        console.warn('dist/ not found — run npm run build first');
        return;
      }

      const accessible = getWebAccessibleResources(manifest);
      const utilsResources = accessible.filter((r: string) => r.startsWith('utils/') && r.endsWith('.js'));

      const missing: string[] = [];
      for (const rel of utilsResources) {
        const absPath = join(distDir, rel);
        if (!existsSync(absPath)) {
          missing.push(rel);
        }
      }

      expect(missing).toEqual([]);
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