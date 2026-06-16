/**
 * build-store-zip.mjs のテスト
 *
 * 検証対象:
 * - shouldExcludeFile: ソースマップ (.map) と TypeScript ビルド情報 (.tsbuildinfo) を除外する
 * - shouldExcludeDir: __tests__, test-results, playwright-report ディレクトリを除外する
 * - collectFiles: ディレクトリの再帰的走査と除外ロジック
 * - buildStoreZip: ZIP 生成（サイズ・ファイル数の妥当性）
 * - verifyStoreZip: manifest.json ルート存在、サイズ上限、ソースマップ除外
 * - getPackageVersion: package.json からのバージョン抽出
 * - defaultOutPath: yasumaro-{version}.zip パスの生成
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, statSync, readFileSync } from 'fs';
import { join, sep, dirname as pathDirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

import {
  shouldExcludeFile,
  shouldExcludeDir,
  collectFiles,
  buildStoreZip,
  verifyStoreZip,
  getPackageVersion,
  defaultOutPath,
  MAX_ZIP_SIZE,
  EXCLUDE_FILE_PATTERNS,
  EXCLUDE_DIR_PATTERNS,
} from '../build-store-zip.mjs';

describe('shouldExcludeFile', () => {
  it('excludes .map source map files', () => {
    expect(shouldExcludeFile('background.js.map')).toBe(true);
  });

  it('excludes .tsbuildinfo files', () => {
    expect(shouldExcludeFile('tsconfig.tsbuildinfo')).toBe(true);
  });

  it('excludes .DS_Store (macOS metadata)', () => {
    expect(shouldExcludeFile('.DS_Store')).toBe(true);
  });

  it('does NOT exclude manifest.json', () => {
    expect(shouldExcludeFile('manifest.json')).toBe(false);
  });

  it('does NOT exclude .js files (e.g., background.js)', () => {
    expect(shouldExcludeFile('background.js')).toBe(false);
  });

  it('does NOT exclude .png files', () => {
    expect(shouldExcludeFile('icon128.png')).toBe(false);
  });

  it('excludes .bak* backup files', () => {
    expect(shouldExcludeFile('messages.json.bak')).toBe(true);
    expect(shouldExcludeFile('messages.json.bak2')).toBe(true);
    expect(shouldExcludeFile('messages.json.bak99')).toBe(true);
  });

  it('excludes i18n temp files (-base.json, -new.json)', () => {
    expect(shouldExcludeFile('messages-base.json')).toBe(true);
    expect(shouldExcludeFile('messages-new.json')).toBe(true);
    expect(shouldExcludeFile('messages-temp.json')).toBe(true);
    expect(shouldExcludeFile('messages-fixed.json')).toBe(true);
  });
});

describe('shouldExcludeDir', () => {
  it('excludes __tests__ directory', () => {
    expect(shouldExcludeDir(`src${sep}__tests__`)).toBe(true);
  });

  it('excludes test-results directory', () => {
    expect(shouldExcludeDir('test-results')).toBe(true);
  });

  it('excludes playwright-report directory', () => {
    expect(shouldExcludeDir(`playwright-report${sep}index.html`)).toBe(true);
  });

  it('does NOT exclude _locales directory', () => {
    expect(shouldExcludeDir(`_locales${sep}en`)).toBe(false);
  });

  it('does NOT exclude icons directory', () => {
    expect(shouldExcludeDir('icons')).toBe(false);
  });
});

describe('EXCLUDE_FILE_PATTERNS / EXCLUDE_DIR_PATTERNS', () => {
  it('EXCLUDE_FILE_PATTERNS is non-empty array', () => {
    expect(Array.isArray(EXCLUDE_FILE_PATTERNS)).toBe(true);
    expect(EXCLUDE_FILE_PATTERNS.length).toBeGreaterThan(0);
  });

  it('EXCLUDE_DIR_PATTERNS is non-empty array', () => {
    expect(Array.isArray(EXCLUDE_DIR_PATTERNS)).toBe(true);
    expect(EXCLUDE_DIR_PATTERNS.length).toBeGreaterThan(0);
  });
});

describe('collectFiles', () => {
  let tmpDir;
  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'zip-test-'));
    // テスト用ファイル構造
    mkdirSync(join(tmpDir, 'icons'));
    mkdirSync(join(tmpDir, '_locales', 'en'), { recursive: true });
    mkdirSync(join(tmpDir, '__tests__'));
    mkdirSync(join(tmpDir, 'nested', 'sub'), { recursive: true });

    writeFileSync(join(tmpDir, 'manifest.json'), '{"name":"test"}');
    writeFileSync(join(tmpDir, 'background.js'), '// bg');
    writeFileSync(join(tmpDir, 'background.js.map'), '// map');
    writeFileSync(join(tmpDir, 'icons', 'icon16.png'), 'fake-png');
    writeFileSync(join(tmpDir, '_locales', 'en', 'messages.json'), '{}');
    writeFileSync(join(tmpDir, '__tests__', 'test.ts'), '// test');
    writeFileSync(join(tmpDir, 'nested', 'sub', 'file.txt'), 'content');
    writeFileSync(join(tmpDir, 'tsconfig.tsbuildinfo'), '{}');
  });

  afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws when source directory does not exist', () => {
    expect(() => collectFiles('/non/existent/path')).toThrow(/does not exist/);
  });

  it('returns all non-excluded files recursively', () => {
    const files = collectFiles(tmpDir);
    const names = files.map((f) => f.relativePath);

    expect(names).toContain('manifest.json');
    expect(names).toContain('background.js');
    expect(names).toContain(join('icons', 'icon16.png'));
    expect(names).toContain(join('_locales', 'en', 'messages.json'));
    expect(names).toContain(join('nested', 'sub', 'file.txt'));
  });

  it('excludes .map source map files', () => {
    const files = collectFiles(tmpDir);
    const names = files.map((f) => f.relativePath);
    expect(names).not.toContain('background.js.map');
  });

  it('excludes .tsbuildinfo files', () => {
    const files = collectFiles(tmpDir);
    const names = files.map((f) => f.relativePath);
    expect(names).not.toContain('tsconfig.tsbuildinfo');
  });

  it('excludes __tests__ directory contents', () => {
    const files = collectFiles(tmpDir);
    const names = files.map((f) => f.relativePath);
    expect(names.some((n) => n.includes('__tests__'))).toBe(false);
  });
});

describe('buildStoreZip + verifyStoreZip', () => {
  // Use shared resources via setup helpers. Tests use beforeAll to await async setup.
  const ctx = {
    tmpDir: /** @type {string | undefined} */ (undefined),
    outZip: /** @type {string | undefined} */ (undefined),
  };

  beforeAll(async () => {
    ctx.tmpDir = mkdtempSync(join(tmpdir(), 'zip-build-'));
    mkdirSync(join(ctx.tmpDir, 'icons'));
    mkdirSync(join(ctx.tmpDir, '_locales', 'en'), { recursive: true });

    writeFileSync(join(ctx.tmpDir, 'manifest.json'), JSON.stringify({ name: 'test', version: '1.0.0' }));
    writeFileSync(join(ctx.tmpDir, 'background.js'), '// bg');
    writeFileSync(join(ctx.tmpDir, 'background.js.map'), '// map - should be excluded');
    writeFileSync(join(ctx.tmpDir, 'icons', 'icon16.png'), 'fake-png');
    writeFileSync(join(ctx.tmpDir, '_locales', 'en', 'messages.json'), '{}');
    writeFileSync(join(ctx.tmpDir, '_locales', 'en', 'messages.json.bak2'), '{} - excluded');
    writeFileSync(join(ctx.tmpDir, 'data-old-base.json'), '{} - excluded');

    ctx.outZip = join(ctx.tmpDir, 'test-output.zip');
    await buildStoreZip({ srcDir: ctx.tmpDir, outPath: ctx.outZip, silent: true });
  });

  afterAll(() => {
    if (ctx.tmpDir) rmSync(ctx.tmpDir, { recursive: true, force: true });
  });

  it('creates a ZIP file at the specified path', () => {
    expect(ctx.outZip).toBeDefined();
    expect(existsSync(ctx.outZip)).toBe(true);
  });

  it('ZIP is non-empty', () => {
    expect(ctx.outZip).toBeDefined();
    const stats = statSync(ctx.outZip);
    expect(stats.size).toBeGreaterThan(0);
  });

  it('verifyStoreZip passes for a valid ZIP', () => {
    expect(ctx.outZip).toBeDefined();
    const result = verifyStoreZip(ctx.outZip);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.entryCount).toBeGreaterThan(0);
  });

  it('ZIP contains manifest.json at root', () => {
    expect(ctx.outZip).toBeDefined();
    const zip = new AdmZip(ctx.outZip);
    const entries = zip.getEntries().map((e) => e.entryName);
    expect(entries).toContain('manifest.json');
  });

  it('ZIP does NOT contain source maps', () => {
    expect(ctx.outZip).toBeDefined();
    const zip = new AdmZip(ctx.outZip);
    const entries = zip.getEntries().map((e) => e.entryName);
    const mapEntries = entries.filter((n) => n.endsWith('.map'));
    expect(mapEntries).toEqual([]);
  });

  it('ZIP does NOT contain .bak* backup files', () => {
    expect(ctx.outZip).toBeDefined();
    const zip = new AdmZip(ctx.outZip);
    const entries = zip.getEntries().map((e) => e.entryName);
    const bakEntries = entries.filter((n) => /\.bak\d*$/.test(n));
    expect(bakEntries).toEqual([]);
  });

  it('ZIP does NOT contain -base.json / -new.json temp files', () => {
    expect(ctx.outZip).toBeDefined();
    const zip = new AdmZip(ctx.outZip);
    const entries = zip.getEntries().map((e) => e.entryName);
    expect(entries.some((n) => n.endsWith('-base.json'))).toBe(false);
    expect(entries.some((n) => n.endsWith('-new.json'))).toBe(false);
  });
});

describe('verifyStoreZip - error cases', () => {
  let tmpDir;
  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'zip-err-'));
  });

  afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns invalid when ZIP does not exist', () => {
    const result = verifyStoreZip(join(tmpDir, 'nonexistent.zip'));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/not found/);
  });

  it('returns invalid when ZIP has no manifest.json at root', async () => {
    const srcDir = join(tmpDir, 'no-manifest');
    mkdirSync(srcDir);
    writeFileSync(join(srcDir, 'readme.txt'), 'no manifest');
    const outZip = join(tmpDir, 'no-manifest.zip');
    await buildStoreZip({ srcDir, outPath: outZip, silent: true });
    const result = verifyStoreZip(outZip);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('manifest.json'))).toBe(true);
  });
});

describe('getPackageVersion', () => {
  it('extracts version from project package.json', () => {
    const version = getPackageVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('throws when version is missing', () => {
    const badDir = mkdtempSync(join(tmpdir(), 'no-version-'));
    writeFileSync(join(badDir, 'package.json'), '{"name":"x"}');
    expect(() => getPackageVersion(badDir)).toThrow(/Could not extract version/);
    rmSync(badDir, { recursive: true, force: true });
  });
});

describe('defaultOutPath', () => {
  it('generates yasumaro-{version}.zip path', () => {
    const path = defaultOutPath(ROOT_DIR_HERE, '5.9.9');
    expect(path.endsWith('yasumaro-5.9.9.zip')).toBe(true);
  });
});

describe('MAX_ZIP_SIZE', () => {
  it('is 500MB', () => {
    expect(MAX_ZIP_SIZE).toBe(500 * 1024 * 1024);
  });
});

// Root directory of the project (parent of scripts/).
const ROOT_DIR_HERE = pathDirname(pathDirname(fileURLToPath(import.meta.url)));
