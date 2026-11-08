import { describe, it, expect } from 'vitest';
import { normalizeManifestVersion } from '../wxt.config.js';

describe('normalizeManifestVersion', () => {
  describe('plain releases', () => {
    it('leaves a plain release version untouched', () => {
      expect(normalizeManifestVersion('6.9.72')).toBe('6.9.72');
    });
  });

  describe('prerelease suffix', () => {
    it('strips a -dev prerelease suffix', () => {
      expect(normalizeManifestVersion('6.9.0-dev')).toBe('6.9.0');
    });

    it('strips a dotted prerelease suffix', () => {
      expect(normalizeManifestVersion('1.2.3-alpha.1')).toBe('1.2.3');
    });
  });

  describe('build metadata', () => {
    it('strips trailing build metadata so the manifest version stays loadable', () => {
      expect(normalizeManifestVersion('1.2.3+build.5')).toBe('1.2.3');
    });

    it('strips build metadata that follows a prerelease suffix', () => {
      expect(normalizeManifestVersion('1.2.3-dev+build.5')).toBe('1.2.3');
    });

    it('never leaves a plus segment in the normalized version', () => {
      for (const input of ['1.2.3+001', '1.2.3-alpha.1+001', '2.0.0-rc.1+build.123']) {
        expect(normalizeManifestVersion(input)).not.toContain('+');
      }
    });
  });
});
