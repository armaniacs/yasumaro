// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  updateProviderSettingsLayout,
  hideAllProviderSettings,
  restoreOriginalProviderSettingsLayout,
} from '../aiProviderLayoutManager.js';

/** Build fresh DOM with priority containers and provider settings divs inside parents. */
function buildDom(): { containerEls: HTMLElement[]; parentEls: HTMLElement[] } {
  document.body.innerHTML = '';

  const containerEls: HTMLElement[] = [];
  for (let p = 1; p <= 3; p++) {
    const el = document.createElement('div');
    el.id = `priority${p}ProviderSettings`;
    document.body.appendChild(el);
    containerEls.push(el);
  }

  const settingsIds = [
    'geminiSettings',
    'openaiSettings',
    'openai2Settings',
    'lm-studioSettings',
    'ollamaSettings',
    'openai-compatibleSettings',
  ];

  const parentEls: HTMLElement[] = [];
  for (const id of settingsIds) {
    const parent = document.createElement('div');
    parent.className = 'original-parent';
    const child = document.createElement('div');
    child.id = id;
    parent.appendChild(child);
    document.body.appendChild(parent);
    parentEls.push(parent);
  }

  return { containerEls, parentEls };
}

describe('aiProviderLayoutManager', () => {
  // Restore tests run FIRST so module-level originalParents is still empty.
  // Subsequent tests also work because they never call restoreOriginalProviderSettingsLayout.
  //
  // parentEls index layout:
  //   0=geminiSettings, 1=openaiSettings, 2=openai2Settings,
  //   3=lm-studioSettings, 4=ollamaSettings, 5=openai-compatibleSettings

  describe('restoreOriginalProviderSettingsLayout', () => {
    it('moves settings back to their original parents', () => {
      const { containerEls, parentEls } = buildDom();

      updateProviderSettingsLayout(['gemini', 'openai', 'ollama']);

      // After move: in containers, not in parents
      expect(containerEls[0].contains(document.getElementById('geminiSettings'))).toBe(true);
      expect(parentEls[0].contains(document.getElementById('geminiSettings'))).toBe(false);
      expect(containerEls[1].contains(document.getElementById('openaiSettings'))).toBe(true);
      expect(parentEls[1].contains(document.getElementById('openaiSettings'))).toBe(false);
      expect(containerEls[2].contains(document.getElementById('ollamaSettings'))).toBe(true);

      restoreOriginalProviderSettingsLayout();

      // After restore: back in parents
      expect(parentEls[0].contains(document.getElementById('geminiSettings'))).toBe(true);
      expect(parentEls[1].contains(document.getElementById('openaiSettings'))).toBe(true);
      expect(parentEls[4].contains(document.getElementById('ollamaSettings'))).toBe(true);
      expect(containerEls[0].contains(document.getElementById('geminiSettings'))).toBe(false);
    });

    it('handles missing settings element gracefully', () => {
      buildDom();
      updateProviderSettingsLayout(['gemini', '', '']);
      document.getElementById('geminiSettings')?.remove();

      expect(() => restoreOriginalProviderSettingsLayout()).not.toThrow();
    });

    it('does nothing when no layout update was called', () => {
      buildDom();
      expect(() => restoreOriginalProviderSettingsLayout()).not.toThrow();
    });
  });

  describe('updateProviderSettingsLayout', () => {
    it('moves each provider settings div into the correct priority container', () => {
      const { containerEls } = buildDom();

      updateProviderSettingsLayout(['gemini', 'openai', 'ollama']);

      expect(containerEls[0].querySelector('#geminiSettings')).not.toBeNull();
      expect(containerEls[1].querySelector('#openaiSettings')).not.toBeNull();
      expect(containerEls[2].querySelector('#ollamaSettings')).not.toBeNull();

      expect(containerEls[0].querySelector('#openaiSettings')).toBeNull();
      expect(containerEls[1].querySelector('#geminiSettings')).toBeNull();
    });

    it('handles all six providers across all slots', () => {
      const { containerEls } = buildDom();

      updateProviderSettingsLayout(['gemini', 'openai', 'openai2']);
      updateProviderSettingsLayout(['lm-studio', 'ollama', 'openai-compatible']);

      expect(containerEls[0].querySelector('#geminiSettings')).not.toBeNull();
      expect(containerEls[0].querySelector('#lm-studioSettings')).not.toBeNull();
      expect(containerEls[1].querySelector('#openaiSettings')).not.toBeNull();
      expect(containerEls[1].querySelector('#ollamaSettings')).not.toBeNull();
      expect(containerEls[2].querySelector('#openai2Settings')).not.toBeNull();
      expect(containerEls[2].querySelector('#openai-compatibleSettings')).not.toBeNull();
    });

    it('quietly returns when the container does not exist', () => {
      buildDom();
      document.querySelector('#priority1ProviderSettings')?.remove();

      expect(() => updateProviderSettingsLayout(['gemini', '', ''])).not.toThrow();
    });

    it('quietly returns when provider string is empty', () => {
      buildDom();
      expect(() => updateProviderSettingsLayout(['', '', ''])).not.toThrow();
    });

    it('quietly returns when provider is unrecognized', () => {
      buildDom();
      expect(() => updateProviderSettingsLayout(['unknown', '', ''])).not.toThrow();
    });

    it('quietly returns when the settings element is missing', () => {
      buildDom();
      document.querySelector('#geminiSettings')?.remove();

      expect(() => updateProviderSettingsLayout(['gemini', '', ''])).not.toThrow();
    });

    it('sets display:block on moved settings', () => {
      buildDom();
      const geminiEl = document.getElementById('geminiSettings')!;
      geminiEl.style.display = 'none';

      updateProviderSettingsLayout(['gemini', '', '']);

      expect(geminiEl.style.display).toBe('block');
    });
  });

  describe('hideAllProviderSettings', () => {
    it('sets display:none on all provider settings divs', () => {
      buildDom();

      hideAllProviderSettings();

      for (const id of ['geminiSettings', 'openaiSettings', 'openai2Settings', 'lm-studioSettings', 'ollamaSettings', 'openai-compatibleSettings']) {
        const el = document.getElementById(id);
        expect(el?.style.display).toBe('none');
      }
    });

    it('does not throw when some elements are missing', () => {
      buildDom();
      document.getElementById('geminiSettings')?.remove();
      document.getElementById('ollamaSettings')?.remove();

      expect(() => hideAllProviderSettings()).not.toThrow();
    });

    it('does not throw when no DOM is present', () => {
      expect(() => hideAllProviderSettings()).not.toThrow();
    });
  });
});
