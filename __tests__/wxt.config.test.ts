import { describe, it, expect } from 'vitest';
import { normalizeManifestVersion, resolveE2eProbeDefine } from '../wxt.config.js';

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

    it('strips a multi-hyphen prerelease suffix entirely (No.10)', () => {
      expect(normalizeManifestVersion('1.2.3-alpha-beta')).toBe('1.2.3');
    });

    it('strips a three-segment hyphen prerelease suffix entirely', () => {
      expect(normalizeManifestVersion('1.2.3-alpha-beta-gamma')).toBe('1.2.3');
    });
  });

  describe('build metadata', () => {
    it('strips trailing build metadata so the manifest version stays loadable', () => {
      expect(normalizeManifestVersion('1.2.3+build.5')).toBe('1.2.3');
    });

    it('strips build metadata that follows a prerelease suffix', () => {
      expect(normalizeManifestVersion('1.2.3-dev+build.5')).toBe('1.2.3');
    });

    it('strips build metadata that follows a multi-hyphen prerelease suffix', () => {
      expect(normalizeManifestVersion('1.2.3-alpha-beta+build.5')).toBe('1.2.3');
    });

    it('never leaves a plus segment in the normalized version', () => {
      for (const input of ['1.2.3+001', '1.2.3-alpha.1+001', '2.0.0-rc.1+build.123']) {
        expect(normalizeManifestVersion(input)).not.toContain('+');
      }
    });

    it('never leaves a hyphen segment in the normalized version', () => {
      for (const input of ['1.2.3-alpha-beta', '1.2.3-alpha-beta+build.5', '6.9.0-dev']) {
        expect(normalizeManifestVersion(input)).not.toContain('-');
      }
    });
  });

  describe('resolveE2eProbeDefine (S32 opt-in mapping)', () => {
    it("resolves to true only for exactly '1'", () => {
      expect(resolveE2eProbeDefine('1')).toBe(true);
    });

    it('resolves to false for every other value', () => {
      for (const input of ['0', 'true', 'yes', '', undefined]) {
        expect(resolveE2eProbeDefine(input)).toBe(false);
      }
    });
  });
});
