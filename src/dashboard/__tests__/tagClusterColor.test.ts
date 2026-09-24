// @vitest-environment jsdom
/**
 * tagClusterColor unit tests (PBI 2026-09-24-08): same tag → same hue, hue
 * spread over a small realistic set, fixed saturation/lightness constants,
 * and WCAG contrast >= 4.5:1 of the fixed colors against the dashboard panel
 * backgrounds (#ffffff light scheme, #0d1117 dark scheme).
 */
import { describe, it, expect } from 'vitest';
import {
  fnv1a32,
  tagHue,
  tagHslColor,
  TAG_COMPARE_SATURATION_LIGHT,
  TAG_COMPARE_LIGHTNESS_LIGHT,
  TAG_COMPARE_SATURATION_DARK,
  TAG_COMPARE_LIGHTNESS_DARK,
} from '../tagClusterColor.js';

/** sRGB relative luminance (WCAG 2.1) for 0..255 channel values. */
function channelLuminance(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(r: number, g: number, b: number): number {
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (h % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = l - c / 2;
  return rgb.map((v) => (v + m) * 255) as [number, number, number];
}

function contrastRatio(foreground: [number, number, number], background: [number, number, number]): number {
  const l1 = relativeLuminance(...foreground);
  const l2 = relativeLuminance(...background);
  const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

describe('tagClusterColor — stable hue mapping', () => {
  it('maps the same tag to the same hue on every call', () => {
    for (const tag of ['rust', 'AI・機械学習', 'web-dev', '観光', 'x']) {
      expect(tagHue(tag)).toBe(tagHue(tag));
      expect(tagHslColor(tag)).toBe(tagHslColor(tag));
    }
  });

  it('produces hues within [0, 360)', () => {
    for (const tag of ['', 'a', 'obsidian', 'プログラミング', 'chrome-extension', 'ß'.repeat(9)]) {
      const hue = tagHue(tag);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
      expect(Number.isInteger(hue)).toBe(true);
    }
  });

  it('spreads distinct hues across a small realistic tag set (no immediate collisions)', () => {
    const tags = [
      'rust', 'typescript', 'python', 'react', 'obsidian',
      'browser', 'web', 'dev', 'chrome', 'ai',
    ];
    const hues = tags.map(tagHue);
    expect(new Set(hues).size).toBe(hues.length);
  });

  it('keeps FNV-1a 32-bit output in the unsigned 32-bit range', () => {
    for (const input of ['', 'a', 'hash-me-please', 'タグクラスタ']) {
      const hash = fnv1a32(input);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('tagClusterColor — fixed scheme constants', () => {
  it('pins the fixed saturation/lightness constants', () => {
    expect(TAG_COMPARE_SATURATION_LIGHT).toBe(65);
    expect(TAG_COMPARE_LIGHTNESS_LIGHT).toBe(28);
    expect(TAG_COMPARE_SATURATION_DARK).toBe(55);
    expect(TAG_COMPARE_LIGHTNESS_DARK).toBe(72);
  });

  it('formats the light-scheme color string from the constants', () => {
    expect(tagHslColor('rust')).toBe(`hsl(${tagHue('rust')}, 65%, 28%)`);
  });
});

describe('tagClusterColor — WCAG contrast >= 4.5:1', () => {
  const hueSample = [0, 30, 45, 60, 75, 90, 120, 150, 180, 210, 240, 270, 300, 330, 359];

  it('clears 4.5:1 for the light-scheme fill on the white panel background', () => {
    const white: [number, number, number] = [255, 255, 255];
    for (const hue of hueSample) {
      const rgb = hslToRgb(hue, TAG_COMPARE_SATURATION_LIGHT / 100, TAG_COMPARE_LIGHTNESS_LIGHT / 100);
      expect(contrastRatio(rgb, white)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('clears 4.5:1 for the dark-scheme fill on the dark panel background', () => {
    // --color-bg-white under prefers-color-scheme: dark (dashboard.css).
    const dark: [number, number, number] = [0x0d, 0x11, 0x17];
    for (const hue of hueSample) {
      const rgb = hslToRgb(hue, TAG_COMPARE_SATURATION_DARK / 100, TAG_COMPARE_LIGHTNESS_DARK / 100);
      expect(contrastRatio(rgb, dark)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
