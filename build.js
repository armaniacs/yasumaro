#!/usr/bin/env node
/**
 * Build script for TypeScript Chrome Extension
 */

import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 拡張機能に必要な静的ファイルリスト
const STATIC_FILES = [
  { src: 'manifest.json', dist: 'manifest.json' },
  { src: 'icons/icon16.png', dist: 'icons/icon16.png' },
  { src: 'icons/icon48.png', dist: 'icons/icon48.png' },
  { src: 'icons/icon128.png', dist: 'icons/icon128.png' },
  { src: 'src/popup/popup.html', dist: 'src/popup/popup.html' },
  { src: 'src/popup/styles.css', dist: 'src/popup/styles.css' },
];

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function copyFile(src, dest) {
  const srcPath = join(__dirname, src);
  const destPath = join(__dirname, 'dist', dest);

  if (!existsSync(srcPath)) {
    console.log(`Warning: ${src} does not exist, skipping...`);
    return;
  }

  ensureDir(dirname(destPath));
  copyFileSync(srcPath, destPath);
  console.log(`Copied: ${src} -> dist/${dest}`);
}

function copyDirRecursive(srcDir, destDir, fileExtension = null) {
  if (!existsSync(srcDir)) {
    console.log(`Warning: ${srcDir} does not exist, skipping...`);
    return;
  }

  const entries = readdirSync(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);

    if (entry.isDirectory()) {
      // Skip __tests__ directory
      if (entry.name === '__tests__') continue;
      ensureDir(destPath);
      copyDirRecursive(srcPath, destPath, fileExtension);
    } else if (entry.isFile()) {
      // If fileExtension is specified, only copy files with that extension
      if (fileExtension && !entry.name.endsWith(fileExtension)) continue;
      // Skip TypeScript files
      if (entry.name.endsWith('.ts')) continue;
      copyFileSync(srcPath, destPath);
    }
  }
}

function main() {
  console.log('Copying static files to dist...');
  STATIC_FILES.forEach(file => {
    copyFile(file.src, file.dist);
  });

  // Copy _locales (copy directory recursively)
  const localesSrc = join(__dirname, '_locales');
  const localesDist = join(__dirname, 'dist/_locales');

  copyDirRecursive(localesSrc, localesDist);

  if (existsSync(localesSrc)) {
    console.log('Copied: _locales/* -> dist/_locales/');
  }

  // Copy src/popup JS files that are not TypeScript
  const popupJsSrc = join(__dirname, 'src/popup');
  const popupJsDist = join(__dirname, 'dist/src/popup');
  copyDirRecursive(popupJsSrc, popupJsDist, '.js');

  console.log('Static files copied successfully!');
}

main();