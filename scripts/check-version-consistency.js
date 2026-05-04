#!/usr/bin/env node

/**
 * Version consistency checker for Obsidian Weave
 * Ensures all version-related files have matching version numbers
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

export const VERSION_FILES = [
  'package.json',
  'manifest.json',
  'wxt.config.ts'
];

export function extractVersion(content, filePath) {
  // package.json: "version": "5.1.14"
  if (filePath.includes('package.json')) {
    const match = content.match(/"version"\s*:\s*"([^"]+)"/);
    return match ? match[1] : null;
  }

  // manifest.json: "version": "5.1.14"
  if (filePath.includes('manifest.json')) {
    const match = content.match(/"version"\s*:\s*"([^"]+)"/);
    return match ? match[1] : null;
  }

  // wxt.config.ts: version: '5.1.14'
  if (filePath.includes('wxt.config.ts')) {
    const match = content.match(/version\s*:\s*['"]([^'"]+)['"]/);
    return match ? match[1] : null;
  }

  return null;
}

export function readVersions(rootDir) {
  const versions = {};
  for (const file of VERSION_FILES) {
    const content = readFileSync(join(rootDir, file), 'utf8');
    const version = extractVersion(content, file);
    if (!version) {
      throw new Error(`Could not extract version from ${file}`);
    }
    versions[file] = version;
  }
  return versions;
}

export function checkVersionConsistency(rootDir) {
  const versions = readVersions(rootDir);

  console.log('🔍 Checking version consistency...\n');
  Object.entries(versions).forEach(([file, version]) => {
    console.log(`📄 ${file}: ${version}`);
  });

  const uniqueVersions = [...new Set(Object.values(versions))];
  if (uniqueVersions.length === 1) {
    console.log(`\n✅ All version files are consistent: ${uniqueVersions[0]}`);
    return true;
  }

  console.error('\n❌ Version mismatch detected!');
  console.error('Found versions:');
  Object.entries(versions).forEach(([file, version]) => {
    console.error(`  ${file}: ${version}`);
  });
  console.error('\nPlease update all version files to match.');
  return false;
}

// CLI entry point
if (process.argv[1] && (process.argv[1].includes('check-version-consistency'))) {
  const result = checkVersionConsistency(ROOT_DIR);
  if (!result) process.exit(1);
}