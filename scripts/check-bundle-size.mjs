#!/usr/bin/env node

/**
 * Post-build bundle size verification (M26).
 *
 * Recursively sums the byte size of dist/<target> and fails if it exceeds
 * MAX_BUNDLE_BYTES, catching runaway bundle growth (e.g. an accidentally
 * bundled dev dependency) before a release ships.
 *
 * Usage: node scripts/check-bundle-size.mjs [dist-subdir]
 *   dist-subdir defaults to "chromium-mv3"
 */

import { readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

/** 15 MB — current build is ~5MB; leaves headroom for wasm/model growth. */
export const MAX_BUNDLE_BYTES = 15 * 1024 * 1024;

/**
 * Pure size-check logic, independent of the filesystem, so it's unit
 * testable without a real build artifact.
 */
export function checkBundleSize({ totalBytes, maxBytes }) {
  if (totalBytes > maxBytes) {
    return {
      ok: false,
      message: `Bundle size ${(totalBytes / 1024 / 1024).toFixed(2)}MB exceeds the ${(maxBytes / 1024 / 1024).toFixed(2)}MB limit`,
    };
  }
  return {
    ok: true,
    message: `Bundle size ${(totalBytes / 1024 / 1024).toFixed(2)}MB is within the ${(maxBytes / 1024 / 1024).toFixed(2)}MB limit`,
  };
}

function dirSizeBytes(dirPath) {
  let total = 0;
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += dirSizeBytes(fullPath);
    } else {
      total += statSync(fullPath).size;
    }
  }
  return total;
}

function main() {
  const subdir = process.argv[2] || 'chromium-mv3';
  const distPath = join(ROOT_DIR, 'dist', subdir);

  let totalBytes;
  try {
    totalBytes = dirSizeBytes(distPath);
  } catch (error) {
    console.error(`Failed to read build output at ${distPath}: ${error.message}`);
    process.exit(2);
  }

  const result = checkBundleSize({ totalBytes, maxBytes: MAX_BUNDLE_BYTES });
  console.log(result.ok ? `✅ ${result.message}` : `❌ ${result.message}`);
  process.exit(result.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
