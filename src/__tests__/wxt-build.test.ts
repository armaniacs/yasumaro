/**
 * @vitest-environment node
 *
 * wxt-build.test.ts
 * WXT ビルド出力の構造を検証する。
 *
 * TDD: このテストを GREEN にするには wxt build が正常に完了する必要がある。
 * 現時点では WXT 移行が未完了のため RED になることが期待される。
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// WXT は dist/{browser}-mv{version}/ に出力する
const distDir = path.join(process.cwd(), 'dist', 'chromium-mv3');

/**
 * WXT ビルドは dist/chromium-mv3/ に以下の構造を生成する:
 *   dist/chromium-mv3/manifest.json
 *   dist/chromium-mv3/popup.html            (entrypoints/popup/index.html から)
 *   dist/chromium-mv3/options.html          (entrypoints/options/index.html から)
 *   dist/chromium-mv3/permissions.html      (entrypoints/permissions/index.html から)
 *   dist/chromium-mv3/background.js         (entrypoints/background/index.ts から)
 *   dist/chromium-mv3/chunks/content-*.js   (entrypoints/content/loader.ts から)
 */

describe('WXT Build Output', () => {
  describe('manifest.json', () => {
    it('dist/manifest.json が存在する', () => {
      expect(fs.existsSync(path.join(distDir, 'manifest.json'))).toBe(true);
    });

    it('manifest_version が 3 である', () => {
      const manifest = JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8'));
      expect(manifest.manifest_version).toBe(3);
    });

    it('background.service_worker が WXT の出力パスを指している', () => {
      const manifest = JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8'));
      expect(manifest.background?.service_worker).toBe('background.js');
    });

    it('action.default_popup が WXT の popup 出力パスを指している', () => {
      const manifest = JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8'));
      // WXT は popup.html を生成する（entrypoints/popup/index.html から）
      expect(manifest.action?.default_popup).toBe('popup.html');
    });

    it('content_scripts に WXT の content script 出力パスが含まれている', () => {
      const manifest = JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8'));
      const contentScripts = manifest.content_scripts ?? [];
      const jsFiles = contentScripts.flatMap((cs: { js?: string[] }) => cs.js ?? []);
      // WXT は content-scripts/content.js を生成する（entrypoints/content/index.ts から）
      expect(jsFiles.some((f: string) => f.includes('content'))).toBe(true);
    });
  });

  describe('popup entrypoint', () => {
    it('dist/popup.html が存在する', () => {
      expect(fs.existsSync(path.join(distDir, 'popup.html'))).toBe(true);
    });

    it('dist/popup.html に script タグが1つ以上ある', () => {
      const html = fs.readFileSync(path.join(distDir, 'popup.html'), 'utf8');
      const scriptTags = (html.match(/<script[^>]+src=/g) ?? []).length;
      expect(scriptTags).toBeGreaterThanOrEqual(1);
    });

    it('dist/assets/ に popup の CSS が存在する', () => {
      const assetsDir = path.join(distDir, 'assets');
      const files = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : [];
      expect(files.some(f => f.startsWith('popup') && f.endsWith('.css'))).toBe(true);
    });
  });

  describe('options (dashboard) entrypoint', () => {
    it('dist/options.html が存在する', () => {
      expect(fs.existsSync(path.join(distDir, 'options.html'))).toBe(true);
    });
  });

  describe('permissions (privacy) entrypoint', () => {
    it('dist/permissions.html が存在する', () => {
      expect(fs.existsSync(path.join(distDir, 'permissions.html'))).toBe(true);
    });
  });

  describe('background entrypoint', () => {
    it('dist/background.js が存在する', () => {
      // WXT は background/index.ts → background.js に出力する
      expect(fs.existsSync(path.join(distDir, 'background.js'))).toBe(true);
    });
  });

  describe('static assets (public/)', () => {
    it('dist/icons/icon48.png が存在する', () => {
      expect(fs.existsSync(path.join(distDir, 'icons/icon48.png'))).toBe(true);
    });

    it('dist/_locales/en/messages.json が存在する', () => {
      expect(fs.existsSync(path.join(distDir, '_locales/en/messages.json'))).toBe(true);
    });

    it('dist/_locales/ja/messages.json が存在する', () => {
      expect(fs.existsSync(path.join(distDir, '_locales/ja/messages.json'))).toBe(true);
    });
  });

  describe('旧 Vite 出力パスが存在しない', () => {
    it('dist/popup/popup.html が存在しない（WXT は popup.html を生成）', () => {
      expect(fs.existsSync(path.join(distDir, 'popup/popup.html'))).toBe(false);
    });

    it('dist/background/service-worker.js が存在しない（WXT は background.js）', () => {
      expect(fs.existsSync(path.join(distDir, 'background/service-worker.js'))).toBe(false);
    });
  });
});
