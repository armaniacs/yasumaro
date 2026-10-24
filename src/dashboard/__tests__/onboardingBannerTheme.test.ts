/**
 * onboardingBannerTheme.test.ts
 *
 * Regression test for the dark-mode white-on-white onboarding banner.
 * The banner and its choice cards used `var(--color-surface, #ffffff)` while
 * --color-surface was never defined, so dark mode kept a white background
 * with light-mode fallback while the text switched to light colors.
 * This test reads dashboard.css (jsdom does not resolve stylesheets) and
 * asserts the theme aliases exist and the banner text has explicit colors.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'entrypoints', 'options', 'dashboard.css'),
  'utf-8'
);

/** selector list -> declaration bodies, comments removed. */
function rules(): Map<string, string[]> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = new Map<string, string[]>();
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const key = (match[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean).join(', ');
    const body = (match[2] ?? '').replace(/\s+/g, ' ').trim();
    found.set(key, [...(found.get(key) ?? []), body]);
  }
  return found;
}

const all = rules();

function bodyOf(...selectors: string[]): string {
  for (const [key, bodies] of all) {
    const parts = key.split(', ');
    if (selectors.every((s) => parts.includes(s))) return bodies.join('; ');
  }
  return '';
}

describe('onboardingBannerTheme', () => {
  describe('theme aliases', () => {
    it('defines surface and bg aliases so dark mode never falls back to fixed white', () => {
      const root = bodyOf(':root');
      expect(root).toContain('--color-surface:');
      expect(root).toContain('--color-bg:');
    });
  });

  describe('onboarding banner', () => {
    it('gives the intro paragraph an explicit theme text color', () => {
      expect(bodyOf('.onboarding-banner-head p')).toContain('color: var(--color-text-secondary)');
    });

    it('gives choice cards and titles explicit theme text colors instead of UA button black', () => {
      expect(bodyOf('.onboarding-choice')).toContain('color: var(--color-text)');
      expect(bodyOf('.onboarding-choice-title')).toContain('color: var(--color-text)');
    });
  });
});
