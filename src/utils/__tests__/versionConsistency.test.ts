/**
 * Test that all version files (package.json, manifest.json, wxt.config.ts)
 * have matching version numbers. This prevents the build from failing
 * due to version drift.
 */

import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { readFileSync } from 'fs';

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

  it('package-lock.json should be in sync with package.json (prevents npm ci failures in CI)', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as {
      version: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf-8')) as {
      version: string;
      packages: Record<string, { version: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>;
    };

    // Root package version must match
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[''].version).toBe(pkg.version);

    // All direct dependencies declared in package.json must exist in the lock file
    const allDeclared = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };
    const lockedPackageNames = new Set(
      Object.keys(lock.packages)
        .filter((k) => k !== '')
        .map((k) => k.replace(/^node_modules\//, '').replace(/\/node_modules\/.*/, ''))
    );

    const missing: string[] = [];
    for (const dep of Object.keys(allDeclared)) {
      if (!lockedPackageNames.has(dep)) {
        missing.push(dep);
      }
    }

    expect(missing, `These packages are in package.json but missing from package-lock.json. Run "npm install" to fix: ${missing.join(', ')}`).toHaveLength(0);
  });
});
