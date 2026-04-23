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

function extractVersion(content, filePath) {
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

function checkVersionConsistency() {
  const files = [
    'package.json',
    'manifest.json',
    'wxt.config.ts'
  ];

  const versions = {};

  console.log('🔍 Checking version consistency...\n');

  for (const file of files) {
    try {
      const content = readFileSync(join(ROOT_DIR, file), 'utf8');
      const version = extractVersion(content, file);

      if (!version) {
        console.error(`❌ Could not extract version from ${file}`);
        process.exit(1);
      }

      versions[file] = version;
      console.log(`📄 ${file}: ${version}`);

    } catch (error) {
      console.error(`❌ Error reading ${file}: ${error.message}`);
      process.exit(1);
    }
  }

  // Check if all versions are the same
  const versionValues = Object.values(versions);
  const uniqueVersions = [...new Set(versionValues)];

  if (uniqueVersions.length === 1) {
    console.log(`\n✅ All version files are consistent: ${uniqueVersions[0]}`);
    return true;
  } else {
    console.error('\n❌ Version mismatch detected!');
    console.error('Found versions:');
    Object.entries(versions).forEach(([file, version]) => {
      console.error(`  ${file}: ${version}`);
    });
    console.error('\nPlease update all version files to match.');
    process.exit(1);
  }
}

checkVersionConsistency();