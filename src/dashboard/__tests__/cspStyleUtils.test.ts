// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import { setElementColor, setElementWidth, escapeCssIdentifier, escapeCssValue } from '../cspStyleUtils.js';

describe('cspStyleUtils — CSS injection prevention (H7)', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="target"></div>';
  });

  describe('escapeCssIdentifier', () => {
    it('allows alphanumerics, hyphens, underscores', () => {
      expect(escapeCssIdentifier('foo-bar_123')).toBe('foo-bar_123');
    });
    it('strips CSS meta-characters', () => {
      expect(escapeCssIdentifier('foo<bar>{test}')).toBe('foobartest');
    });
  });

  describe('escapeCssValue', () => {
    it('strips semicolons, braces, angle brackets, backslashes', () => {
      expect(escapeCssValue('red}<script>')).toBe('redscript');
    });
    it('strips url() javascript: values', () => {
      expect(escapeCssValue('url(javascript:alert(1))')).toBe('urljavascript:alert1');
    });
  });

  describe('setElementColor', () => {
    it('applies a safe color', () => {
      setElementColor('target', 'red');
      const el = document.getElementById('target');
      expect(el?.style.color).toBe('red');
    });
    it('rejects malicious color value', () => {
      setElementColor('target', 'red; background:url(javascript:alert(1))');
      const el = document.getElementById('target');
      expect(el?.style.getPropertyValue('color')).not.toContain('javascript');
      expect(el?.style.getPropertyValue('background')).toBe('');
    });
  });

  describe('setElementWidth', () => {
    it('applies a safe width', () => {
      setElementWidth('target', '100px');
      const el = document.getElementById('target');
      expect(el?.style.width).toBe('100px');
    });
    it('rejects malicious width value', () => {
      setElementWidth('target', '100px}; color:red');
      const el = document.getElementById('target');
      expect(el?.style.getPropertyValue('width')).not.toContain('}');
    });
  });
});
