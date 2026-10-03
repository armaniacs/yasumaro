// @vitest-environment jsdom
/**
 * Parity for the general settings panel's priority-slot select wiring
 * (PBI 2026-10-03-23): option rendering (slot 1 required without the None
 * option, slots 2-3 optional with the includeNone option), the change
 * listeners on all three selects, and the summary-name mapping
 * (index i -> data-priority i+1, empty value -> empty text) must behave
 * exactly as before the priority id-list SSOT refactor.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createGeneralSettingsPanel } from '../generalSettingsPanel.js';
import { installTestSecretKek } from '../../../../utils/crypto/__tests__/secretKekHelper.js';

const panelSource = readFileSync(
  resolve(process.cwd(), 'src/dashboard/panels/staticForm/generalSettingsPanel.ts'),
  'utf-8',
);

const PANEL_MARKUP = `
  <section id="panel-general" class="panel active">
    <div id="aiProviderSection" class="settings-section">
      <h3 class="settings-section-title">AI Provider</h3>
      <details class="priority-details" open>
        <summary class="priority-details-summary">
          <span class="priority-number">1</span>
          <span class="priority-provider-name" data-priority="1"></span>
        </summary>
        <div class="priority-details-content">
          <select id="aiProvider" data-storage-key="ai_provider"></select>
          <div id="priority1ProviderSettings"></div>
          <input type="text" id="aiProviderPriority1Model">
        </div>
      </details>
      <details class="priority-details">
        <summary class="priority-details-summary">
          <span class="priority-number">2</span>
          <span class="priority-provider-name" data-priority="2"></span>
        </summary>
        <div class="priority-details-content">
          <select id="aiProviderPriority2"></select>
          <div id="priority2ProviderSettings"></div>
          <input type="text" id="aiProviderPriority2Model">
        </div>
      </details>
      <details class="priority-details">
        <summary class="priority-details-summary">
          <span class="priority-number">3</span>
          <span class="priority-provider-name" data-priority="3"></span>
        </summary>
        <div class="priority-details-content">
          <select id="aiProviderPriority3"></select>
          <div id="priority3ProviderSettings"></div>
          <input type="text" id="aiProviderPriority3Model">
        </div>
      </details>
      <div id="providerSettingsMount"></div>
    </div>
  </section>`;

function prioritySelect(id: string): HTMLSelectElement {
  return document.getElementById(id) as HTMLSelectElement;
}

function summaryName(priority: number): HTMLElement {
  return document.querySelector(`.priority-provider-name[data-priority="${priority}"]`) as HTMLElement;
}

function optionValues(sel: HTMLSelectElement): string[] {
  return [...sel.options].map((o) => o.value);
}

beforeEach(async () => {
  await installTestSecretKek();
  document.body.innerHTML = PANEL_MARKUP;
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  await chrome.storage.local.set({
    settings: {
      ai_provider: 'openai-compatible',
      ai_provider_layout: 'a',
    },
    settings_migrated: true,
  });
});

describe('generalSettingsPanel — priority select parity', () => {
  it('derives the priority select ids from the shared SSOT constant', () => {
    // The former 4x handwritten id lists are gone; the ids live in
    // PRIORITY_SELECT_IDS (providerPrioritySlots.ts), so a slot change is a
    // single edit there and cannot be missed in the panel.
    expect(panelSource).not.toMatch(/aiProviderPriority[23]/);
    expect(panelSource).toContain('PRIORITY_SELECT_IDS');
  });

  it('renders slot 1 without the None option and slots 2-3 with it plus every provider', async () => {
    const panel = createGeneralSettingsPanel();
    await panel.mount(document.getElementById('panel-general')!);

    const slot1 = optionValues(prioritySelect('aiProvider'));
    expect(slot1.length).toBeGreaterThan(0);
    expect(slot1).not.toContain('');

    for (const optionalId of ['aiProviderPriority2', 'aiProviderPriority3']) {
      const values = optionValues(prioritySelect(optionalId));
      expect(values[0]).toBe('');
      expect(values.slice(1)).toEqual(slot1);
    }
  });

  it('updates each summary name from its slot-N select (data-priority = index+1)', async () => {
    const panel = createGeneralSettingsPanel();
    await panel.mount(document.getElementById('panel-general')!);

    const slot1 = prioritySelect('aiProvider');
    const slot2 = prioritySelect('aiProviderPriority2');
    const slot3 = prioritySelect('aiProviderPriority3');

    // Slot 1 has no None option; slots 2-3 pick the first real provider and
    // leave slot 3 empty. One change refreshes every summary name.
    slot1.value = optionValues(slot1)[0]!;
    slot2.value = optionValues(slot2)[1]!;
    slot3.value = '';
    slot1.dispatchEvent(new Event('change'));

    const name1 = summaryName(1);
    const name2 = summaryName(2);
    const name3 = summaryName(3);
    expect(name1.textContent).toBe(`— ${slot1.options[slot1.selectedIndex]!.text}`);
    expect(name2.textContent).toBe(`— ${slot2.options[slot2.selectedIndex]!.text}`);
    // Empty select value renders an empty summary name (the :empty CSS rule).
    expect(name3.textContent).toBe('');
  });

  it('wires the change listeners on all three priority selects', async () => {
    const panel = createGeneralSettingsPanel();
    await panel.mount(document.getElementById('panel-general')!);

    const slot2 = prioritySelect('aiProviderPriority2');
    const slot3 = prioritySelect('aiProviderPriority3');
    slot2.value = optionValues(slot2)[1]!;
    slot3.value = optionValues(slot3)[1]!;
    // A change on the optional selects alone must refresh the summary names.
    slot2.dispatchEvent(new Event('change'));
    slot3.dispatchEvent(new Event('change'));

    expect(summaryName(2).textContent).toBe(`— ${slot2.options[slot2.selectedIndex]!.text}`);
    expect(summaryName(3).textContent).toBe(`— ${slot3.options[slot3.selectedIndex]!.text}`);
  });
});
