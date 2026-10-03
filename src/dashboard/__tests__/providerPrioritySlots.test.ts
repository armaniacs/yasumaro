// @vitest-environment jsdom
/**
 * providerPrioritySlots.test.ts
 * Parity tests for collectCurrentProviderPrioritySlots (PBI 2026-10-02-01).
 *
 * Pins the call-site behavior of the two consumers of the helper:
 * - settingsPipeline.ts save path: layout b + bList rows -> B collect,
 *   otherwise A collect; a B-collector throw propagates (no silent A
 *   fallback) so the save aborts instead of persisting A/[] content.
 * - generalSettingsPanel.ts B-view init: A collect, empty -> storage fallback.
 *
 * Uses the real DOM collectors (no collector mocks), so every expectation is
 * a literal ProviderSlot[] — a broken fallback order fails the test.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
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

    it('propagates a B-collector throw instead of silently collecting A slots', () => {
      // The A DOM is populated, so the pre-fix silent B-throw -> A fallback
      // returned the A slots below (diverging from the B UI); a B-throw must
      // surface so the save pipeline aborts instead.
      setADom('gemini', '', 'openai', 'gpt-4');
      // Row presence check passes but row reading throws.
      const broken = {
        querySelector: () => document.createElement('div'),
        querySelectorAll: () => {
          throw new Error('unreadable B rows');
        },
      } as unknown as HTMLElement;
      expect(() => collectCurrentProviderPrioritySlots({ layout: 'b', bList: broken })).toThrow(
        'unreadable B rows',
      );
    });

    it('propagates a B-collector throw when the A DOM is empty and no stored snapshot exists', () => {
      // Pre-fix the B throw was swallowed into the A collector's [] and that
      // [] became the save payload while the B UI still showed valid rows.
      document.body.innerHTML = '';
      const broken = {
        querySelector: () => document.createElement('div'),
        querySelectorAll: () => {
          throw new Error('unreadable B rows');
        },
      } as unknown as HTMLElement;
      expect(() => collectCurrentProviderPrioritySlots({ layout: 'b', bList: broken })).toThrow(
        'unreadable B rows',
      );
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

  describe('throw semantics (collector throws propagate, PBI 2026-10-02-09)', () => {
    function breakACollector(): void {
      vi.spyOn(document, 'getElementById').mockImplementation(() => {
        throw new Error('injected A-collector failure');
      });
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('propagates an A-collector throw instead of swallowing to []', () => {
      // Parity: the old save path let collectProviderPrioritySlots() throw;
      // the consolidated helper swallowed it to []. The restore decision
      // propagates again, so this expectation fails on the swallow behavior.
      setADom('gemini', '', '', '');
      breakACollector();
      expect(() => collectCurrentProviderPrioritySlots({ layout: 'a' })).toThrow(
        'injected A-collector failure',
      );
    });

    it('propagates the B-collector error without consulting the A collector', () => {
      // The A collector is rigged to fail here, so if the B throw were
      // swallowed into an A fallback the surfaced error would be the A one;
      // the B error itself must propagate (pre-fix: 'injected A-collector
      // failure' leaked out of the catch block instead).
      setADom('gemini', '', '', '');
      // Row presence check passes but row reading throws.
      const broken = {
        querySelector: () => document.createElement('div'),
        querySelectorAll: () => {
          throw new Error('unreadable B rows');
        },
      } as unknown as HTMLElement;
      breakACollector();
      expect(() => collectCurrentProviderPrioritySlots({ layout: 'b', bList: broken })).toThrow(
        'unreadable B rows',
      );
    });
  });
});
