// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  updateProviderSettingsLayout,
  hideAllProviderSettings,
  restoreOriginalProviderSettingsLayout,
} from '../aiProviderLayoutManager.js';

/** Build fresh DOM with priority containers and provider settings divs inside parents. */
type Container3 = [HTMLElement, HTMLElement, HTMLElement];
type Parent7 = [HTMLElement, HTMLElement, HTMLElement, HTMLElement, HTMLElement, HTMLElement, HTMLElement];

function buildDom(): { containerEls: Container3; parentEls: Parent7 } {
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
    'built-in-aiSettings',
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

  return { containerEls: containerEls as Container3, parentEls: parentEls as Parent7 };
}

describe('aiProviderLayoutManager', () => {
  // Every restore test used to have to run first, because the recorded parents
  // were a module-level Map that no test could clear. restoreOriginalProviderSettingsLayout
  // drops the record now, so the order below carries no hidden dependency.
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

    // The Map was the only owner of the moved HTMLElements and had no teardown,
    // so a destroyed document's parents stayed referenced across re-mounts. A
    // second restore proves the record is gone: the next restore follows the
    // parent that was live at the second move, not the one from the first.
    it('drops the recorded parents, so a re-move restores from the live DOM', () => {
      const { parentEls } = buildDom();

      updateProviderSettingsLayout(['gemini', '', '']);
      restoreOriginalProviderSettingsLayout();

      const staging = document.createElement('div');
      document.body.appendChild(staging);
      staging.appendChild(document.getElementById('geminiSettings')!);

      updateProviderSettingsLayout(['gemini', '', '']);
      restoreOriginalProviderSettingsLayout();

      expect(staging.contains(document.getElementById('geminiSettings'))).toBe(true);
      expect(parentEls[0].contains(document.getElementById('geminiSettings'))).toBe(false);
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
