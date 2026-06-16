#!/usr/bin/env node
/**
 * Chrome Web Store 用 ZIP パッケージ生成スクリプト
 *
 * 機能:
 * - dist/chromium-mv3/ 配下を ZIP 化
 * - ソースマップ (.map) を除外
 * - package.json の version から ファイル名を生成 (yasumaro-{version}.zip)
 * - ZIP の整合性検証 (manifest.json がルートに存在、サイズが 500MB 以下)
 *
 * 使用方法:
 *   node scripts/build-store-zip.mjs                    # デフォルト: dist/chromium-mv3/ -> ./yasumaro-{version}.zip
 *   node scripts/build-store-zip.mjs <srcDir> <outPath> # 任意の入出力
 */

import { readdirSync, readFileSync, statSync, existsSync, mkdirSync } from 'fs';
import { join, dirname, basename, relative, sep } from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

/** Chrome Web Store の ZIP サイズ上限（バイト） */
export const MAX_ZIP_SIZE = 500 * 1024 * 1024; // 500MB

/** ZIP から除外するファイル名パターン（ファイル名のみ、正規表現） */
export const EXCLUDE_FILE_PATTERNS = [
  /\.map$/i, // ソースマップ
  /\.tsbuildinfo$/i, // TypeScript ビルド情報
  /\.DS_Store$/i, // macOS メタデータ
  /^Thumbs\.db$/i, // Windows メタデータ
  /\.bak\d*$/i, // バックアップファイル (e.g., messages.json.bak, .bak2, .bak3)
  /-base\.json$/i, // i18n ベースファイル
  /-fixed\.json$/i,
  /-new\.json$/i,
  /-temp\.json$/i,
];

/** ZIP から除外するディレクトリ名パターン（パス内のいずれかのセグメントにマッチ） */
export const EXCLUDE_DIR_PATTERNS = [
  /^__tests__$/i, // テストディレクトリ
  /^test-results$/i,
  /^playwright-report$/i,
];

/**
 * ファイル名パターンにマッチするか判定
 * @param {string} fileName
 * @returns {boolean}
 */
export function shouldExcludeFile(fileName) {
  return EXCLUDE_FILE_PATTERNS.some((pattern) => pattern.test(fileName));
}

/**
 * パス内のいずれかのセグメントがディレクトリ除外パターンにマッチするか判定
 * @param {string} relativePath
 * @returns {boolean}
 */
export function shouldExcludeDir(relativePath) {
  const segments = relativePath.split(sep);
  return EXCLUDE_DIR_PATTERNS.some((pattern) =>
    segments.some((seg) => pattern.test(seg))
  );
}

/**
 * ディレクトリを再帰的に走査して、ZIP に含めるべきファイルのリストを返す
 * @param {string} srcDir - 走査対象ディレクトリの絶対パス
 * @param {string} [baseDir] - 相対パス計算の基準。省略時は srcDir 自身。
 * @returns {Array<{absolutePath: string, relativePath: string}>}
 */
export function collectFiles(srcDir, baseDir = srcDir) {
  if (!existsSync(srcDir)) {
    throw new Error(`Source directory does not exist: ${srcDir}`);
  }

  const results = [];

  /**
   * @param {string} currentDir
   */
  function walk(currentDir) {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = join(currentDir, entry.name);
      const relativePath = relative(baseDir, absolutePath);

      if (entry.isDirectory()) {
        if (shouldExcludeDir(relativePath)) {
          continue;
        }
        walk(absolutePath);
      } else if (entry.isFile()) {
        if (shouldExcludeFile(entry.name)) {
          continue;
        }
        results.push({ absolutePath, relativePath });
      }
    }
  }

  walk(srcDir);
  return results;
}

/**
 * ソースディレクトリから ZIP を生成し、ファイルとして書き出す
 * @param {object} options
 * @param {string} options.srcDir - ZIP 化対象のディレクトリ
 * @param {string} options.outPath - 出力 ZIP ファイルパス
 * @param {boolean} [options.silent=false] - ログを抑制するか
 * @returns {Promise<{zipPath: string, fileCount: number, sizeBytes: number}>}
 */
export async function buildStoreZip({ srcDir, outPath, silent = false }) {
  if (!existsSync(srcDir)) {
    throw new Error(`Source directory does not exist: ${srcDir}`);
  }

  // ファイル収集
  const files = collectFiles(srcDir);

  // ZIP 構築
  // addLocalFile(localPath, zipPath, zipName):
  //   - localPath: ソースの絶対パス
  //   - zipPath: ZIP 内のディレクトリ（'' でルート）
  //   - zipName: ZIP 内のファイル名（パス区切りなし）
  const zip = new AdmZip();
  for (const { absolutePath, relativePath } of files) {
    const dirInZip = dirname(relativePath);
    const fileName = basename(relativePath);
    zip.addLocalFile(absolutePath, dirInZip === '.' ? '' : dirInZip, fileName);
  }

  // 出力ディレクトリ作成
  const outDir = dirname(outPath);
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  // ファイル書き出し
  await zip.writeZipPromise(outPath);

  // 書き出し後のサイズ取得
  const stats = statSync(outPath);

  if (!silent) {
    console.log(`\n📦 ZIP build complete`);
    console.log(`  Source:  ${srcDir}`);
    console.log(`  Output:  ${outPath}`);
    console.log(`  Files:   ${files.length}`);
    console.log(`  Size:    ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  }

  return {
    zipPath: outPath,
    fileCount: files.length,
    sizeBytes: stats.size,
  };
}

/**
 * 生成済み ZIP の整合性を検証
 * @param {string} zipPath
 * @returns {{valid: boolean, errors: string[], entryCount: number}}
 */
export function verifyStoreZip(zipPath) {
  const errors = [];

  if (!existsSync(zipPath)) {
    return { valid: false, errors: [`ZIP file not found: ${zipPath}`], entryCount: 0 };
  }

  const stats = statSync(zipPath);

  if (stats.size === 0) {
    errors.push('ZIP file is empty');
  }

  if (stats.size > MAX_ZIP_SIZE) {
    errors.push(
      `ZIP size ${stats.size} bytes exceeds Chrome Web Store limit (${MAX_ZIP_SIZE} bytes)`
    );
  }

  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();

  // manifest.json がルートに存在すること
  const manifestEntry = entries.find((e) => e.entryName === 'manifest.json');
  if (!manifestEntry) {
    errors.push('manifest.json not found at ZIP root');
  }

  // ソースマップが含まれていないこと
  const mapEntries = entries.filter((e) => e.entryName.endsWith('.map'));
  if (mapEntries.length > 0) {
    errors.push(`Source map files included (${mapEntries.length} files): ${mapEntries.slice(0, 3).map((e) => e.entryName).join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    entryCount: entries.length,
  };
}

/**
 * package.json からバージョンを取得
 * @param {string} [rootDir=ROOT_DIR]
 * @returns {string}
 */
export function getPackageVersion(rootDir = ROOT_DIR) {
  const packageJsonPath = join(rootDir, 'package.json');
  const content = readFileSync(packageJsonPath, 'utf8');
  const match = content.match(/"version"\s*:\s*"([^"]+)"/);
  if (!match) {
    throw new Error(`Could not extract version from ${packageJsonPath}`);
  }
  return match[1];
}

/**
 * デフォルト出力パスを生成: {rootDir}/yasumaro-{version}.zip
 * @param {string} [rootDir=ROOT_DIR]
 * @param {string} [version]
 * @returns {string}
 */
export function defaultOutPath(rootDir = ROOT_DIR, version) {
  const v = version ?? getPackageVersion(rootDir);
  return join(rootDir, `yasumaro-${v}.zip`);
}

// CLI エントリポイント
if (process.argv[1] && (process.argv[1].endsWith('build-store-zip.mjs') || process.argv[1].endsWith('build-store-zip.js'))) {
  const args = process.argv.slice(2);
  const srcDir = args[0] ?? join(ROOT_DIR, 'dist', 'chromium-mv3');
  const outPath = args[1] ?? defaultOutPath();

  buildStoreZip({ srcDir, outPath })
    .then(() => verifyStoreZip(outPath))
    .then((result) => {
      if (!result.valid) {
        console.error('\n❌ ZIP verification failed:');
        result.errors.forEach((e) => console.error(`  - ${e}`));
        process.exit(1);
      }
      console.log(`\n✅ ZIP verified: ${result.entryCount} entries`);
    })
    .catch((err) => {
      console.error(`\n❌ Build failed: ${err.message}`);
      process.exit(1);
    });
}
