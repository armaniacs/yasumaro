// @vitest-environment jsdom
/**
 * providerPrioritySlots.test.ts
 * Parity tests for collectCurrentProviderPrioritySlots (PBI 2026-10-02-01).
 *
 * Pins the old inline behavior of the two call sites being consolidated:
 * - settingsPipeline.ts save path: layout b + bList rows -> B collect,
 *   B throw -> A fallback, otherwise A collect.
 * - generalSettingsPanel.ts B-view init: A collect, empty -> storage fallback.
 *
 * Uses the real DOM collectors (no collector mocks), so every expectation is
 * a literal ProviderSlot[] — a broken fallback order fails the test.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { collectCurrentProviderPrioritySlots } from '../providerPrioritySlots.js';

function setADom(p1: string, p1Model: string, p2: string, p2Model: string): void {
  document.body.innerHTML = `
    <select id="aiProvider">
      <option value="">--</option>
      <option value="gemini"${p1 === 'gemini' ? ' selected' : ''}>gemini</option>
      <option value="openai"${p1 === 'openai' ? ' selected' : ''}>openai</option>
    </select>
    <input id="aiProviderPriority1Model" value="${p1Model}" />
    <select id="aiProviderPriority2">
      <option value="">--</option>
      <option value="gemini"${p2 === 'gemini' ? ' selected' : ''}>gemini</option>
      <option value="openai"${p2 === 'openai' ? ' selected' : ''}>openai</option>
    </select>
    <input id="aiProviderPriority2Model" value="${p2Model}" />
  `;
}

function makeBList(rows: Array<{ provider: string; model: string }>): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = rows
    .map(
      ({ provider, model }) => `
      <div class="b-priority-row">
        <select>
          <option value="">--</option>
          <option value="gemini"${provider === 'gemini' ? ' selected' : ''}>gemini</option>
          <option value="openai"${provider === 'openai' ? ' selected' : ''}>openai</option>
        </select>
        <input class="b-priority-model-input" value="${model}" />
      </div>`,
    )
    .join('');
  document.body.appendChild(container);
  return container;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('collectCurrentProviderPrioritySlots', () => {
  describe('A layout save path', () => {
    it('returns A slots from the A DOM when layout is a', () => {
      setADom('gemini', 'gemini-2.0-flash', 'openai', '');
      expect(collectCurrentProviderPrioritySlots({ layout: 'a' })).toEqual([
        { provider: 'gemini', model: 'gemini-2.0-flash' },
        { provider: 'openai' },
      ]);
    });

    it('returns A slots from the A DOM when layout is unknown', () => {
      setADom('openai', 'gpt-4o', '', '');
      expect(collectCurrentProviderPrioritySlots({ layout: undefined })).toEqual([
        { provider: 'openai', model: 'gpt-4o' },
      ]);
    });
  });

  describe('B layout save path', () => {
    it('returns B slots when layout is b and the B list has rows', () => {
      setADom('gemini', '', '', '');
      const bList = makeBList([
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'gemini', model: '' },
      ]);
      expect(collectCurrentProviderPrioritySlots({ layout: 'b', bList })).toEqual([
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'gemini' },
      ]);
    });

    it('prefers B slots over stored slots when B rows are non-empty', () => {
      setADom('', '', '', '');
      const bList = makeBList([{ provider: 'openai', model: '' }]);
      const stored = [{ provider: 'gemini' }];
      expect(collectCurrentProviderPrioritySlots({ layout: 'b', bList, stored })).toEqual([
        { provider: 'openai' },
      ]);
    });

    it('falls back to A slots when B collection throws', () => {
      setADom('gemini', '', 'openai', 'gpt-4');
      // Row presence check passes but row reading throws, mirroring the old
      // try { collectB } catch { collectA } fallback in the save path.
      const broken = {
        querySelector: () => document.createElement('div'),
        querySelectorAll: () => {
          throw new Error('unreadable B rows');
        },
      } as unknown as HTMLElement;
      expect(collectCurrentProviderPrioritySlots({ layout: 'b', bList: broken })).toEqual([
        { provider: 'gemini' },
        { provider: 'openai', model: 'gpt-4' },
      ]);
    });

    it('returns A slots when layout is b but no B list is given', () => {
      setADom('gemini', '', '', '');
      expect(collectCurrentProviderPrioritySlots({ layout: 'b' })).toEqual([{ provider: 'gemini' }]);
    });

    it('returns A slots when layout is b but the B list has no rows', () => {
      setADom('openai', 'gpt-4o', '', '');
      const empty = document.createElement('div');
      document.body.appendChild(empty);
      expect(collectCurrentProviderPrioritySlots({ layout: 'b', bList: empty })).toEqual([
        { provider: 'openai', model: 'gpt-4o' },
      ]);
    });
  });

  describe('B-view init storage fallback', () => {
    it('returns stored slots when the A DOM is empty', () => {
      document.body.innerHTML = '';
      const stored = [
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'gemini' },
      ];
      expect(collectCurrentProviderPrioritySlots({ layout: 'b', stored })).toEqual(stored);
    });

    it('returns stored slots when layout is a and the A DOM is empty', () => {
      document.body.innerHTML = '';
      const stored = [{ provider: 'gemini' }];
      expect(collectCurrentProviderPrioritySlots({ layout: 'a', stored })).toEqual(stored);
    });

    it('returns an empty array when the A DOM is empty and no stored slots exist', () => {
      document.body.innerHTML = '';
      expect(collectCurrentProviderPrioritySlots({ layout: 'b' })).toEqual([]);
    });

    it('ignores a non-array stored value', () => {
      document.body.innerHTML = '';
      expect(collectCurrentProviderPrioritySlots({ layout: 'b', stored: 'gemini' })).toEqual([]);
    });
  });
});
