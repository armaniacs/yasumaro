// @vitest-environment wasm-quickjs-dom
/**
 * appVersion.test.ts
 *
 * PBI 2026-11-23-05: popup logo直下の動作中バージョン表示.
 * Outside-In: E2E-equivalent header markup contract -> integration
 * (getManifest seam -> #appVersion element) -> unit (format + failure paths).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatAppVersion, initAppVersion } from '../appVersion.js';

const popupHtml = (): string =>
  readFileSync(resolve(process.cwd(), 'entrypoints/popup/index.html'), 'utf-8');
const entryMainSource = (): string =>
  readFileSync(resolve(process.cwd(), 'entrypoints/popup/main.ts'), 'utf-8');

function setHeaderDom(): void {
  document.body.innerHTML =
    '<div class="header">' +
    '<h1 class="sr-only" data-i18n="appTitle">Yasumaro</h1>' +
    '<h2 data-i18n="appTitle" aria-hidden="true">Yasumaro</h2>' +
    '<span id="appVersion" class="app-version" aria-live="off"></span>' +
    '</div>';
}

describe('appVersion', () => {
  describe('popup header markup', () => {
    it('places the version span right after the logo h2 inside .header', () => {
      const header = popupHtml().match(/<div class="header">([\s\S]*?)<\/div>/)?.[1] ?? '';
      expect(header).toContain('data-i18n="appTitle"');
      const h2End = header.indexOf('</h2>');
      const spanAt = header.indexOf('id="appVersion"');
      expect(h2End).toBeGreaterThan(-1);
      expect(spanAt).toBeGreaterThan(h2End);
      expect(header).toContain('class="app-version"');
      expect(header).toContain('aria-live="off"');
    });

    it('calls initAppVersion after applyI18n in the entrypoint bootstrap', () => {
      const src = entryMainSource();
      expect(src).toContain('initAppVersion();');
      expect(src.indexOf('applyI18n();')).toBeLessThan(src.indexOf('initAppVersion();'));
    });
  });

  describe('initAppVersion', () => {
    beforeEach(() => {
      setHeaderDom();
    });

    it('shows the manifest version with a v prefix', () => {
      initAppVersion({ getManifest: () => ({ version: '6.9.45' }) });
      expect(document.getElementById('appVersion')?.textContent).toBe('v6.9.45');
    });

    it('shows unknown when the manifest read throws, without throwing', () => {
      expect(() =>
        initAppVersion({
          getManifest: () => {
            throw new Error('no manifest');
          },
        }),
      ).not.toThrow();
      expect(document.getElementById('appVersion')?.textContent).toBe('unknown');
    });

    it('leaves the popup intact when the version element is absent', () => {
      document.body.innerHTML = '<div class="header"></div>';
      expect(() => initAppVersion({ getManifest: () => ({ version: '1.0.0' }) })).not.toThrow();
    });

    it('falls back to unknown when no manifest seam is available', () => {
      expect(() => initAppVersion()).not.toThrow();
      expect(document.getElementById('appVersion')?.textContent).toBe('unknown');
    });

    it('does not let a later applyI18n pass wipe the version text', () => {
      initAppVersion({ getManifest: () => ({ version: '6.9.45' }) });
      document
        .querySelectorAll('[data-i18n]')
        .forEach((el) => {
          el.textContent = 'translated';
        });
      expect(document.getElementById('appVersion')?.textContent).toBe('v6.9.45');
    });
  });

  describe('formatAppVersion', () => {
    it('prefixes a bare version with v', () => {
      expect(formatAppVersion('6.9.45')).toBe('v6.9.45');
    });

    it('keeps an already-prefixed version as-is', () => {
      expect(formatAppVersion('v1.2.3')).toBe('v1.2.3');
    });

    it('maps empty, blank, null and undefined to unknown', () => {
      expect(formatAppVersion('')).toBe('unknown');
      expect(formatAppVersion('   ')).toBe('unknown');
      expect(formatAppVersion(null)).toBe('unknown');
      expect(formatAppVersion(undefined)).toBe('unknown');
    });
  });
});
