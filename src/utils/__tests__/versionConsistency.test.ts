/**
 * Test that all version files (package.json, manifest.json, wxt.config.ts)
 * have matching version numbers. This prevents the build from failing
 * due to version drift.
 */

import { describe, it, expect } from 'vitest';
import { join } from 'path';

// Import the shared version check logic from the build script
import { readVersions, VERSION_FILES } from '../../../scripts/check-version-consistency.js';

const ROOT = join(__dirname, '..', '..', '..');

describe('version consistency', () => {
  it('should read the same version from all version files', () => {
    const versions = readVersions(ROOT);

    // Log versions for visibility in test output
    console.log('Versions found:', JSON.stringify(versions, null, 2));

    const values = Object.values(versions);
    const unique = new Set(values);

    expect(unique.size).toBe(1);
  });

  it('should extract a valid semver from each file', () => {
    const versions = readVersions(ROOT);

    for (const [file, version] of Object.entries(versions)) {
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('should read all expected version files', () => {
    const expected = ['package.json', 'manifest.json', 'wxt.config.ts'];
    expect(VERSION_FILES).toEqual(expected);
  });
});
