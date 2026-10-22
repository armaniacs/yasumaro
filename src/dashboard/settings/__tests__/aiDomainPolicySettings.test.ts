// @vitest-environment jsdom
/**
 * aiDomainPolicySettings.test.ts
 * Controller tests for the per-domain AI egress policy editor (PBI 2026-10-23-01).
 *
 * The module resolves the DOM lazily (init/load), so each test builds the
 * section markup and uses vi.resetModules() to get a fresh controller.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { drainMacrotask } from '../../../../testDir/waitPolicy.js';

function setupDOM() {
  document.body.innerHTML = `
    <input type="text" id="aiDomainPolicyInput" />
    <select id="aiDomainPolicySelect"></select>
    <button id="aiDomainPolicyAddBtn">Add</button>
    <div id="aiDomainPolicyList"></div>
    <div id="aiDomainPolicyError" role="alert"></div>
    <div id="aiDomainPolicyStatus" aria-live="polite"></div>
  `;
}

const mockGetAll = vi.hoisted(() => vi.fn());
const mockSetAll = vi.hoisted(() => vi.fn());
const mockShowStatus = vi.hoisted(() => vi.fn());

vi.mock('../../../utils/storage/SettingsRepository.js', () => ({
  settingsRepository: { getAll: mockGetAll, setAll: mockSetAll },
}));

vi.mock('../../../utils/ui/settingsUiHelper.js', () => ({
  showStatus: mockShowStatus,
}));

vi.mock('../../../utils/i18n.js', () => ({
  getMessage: vi.fn((key: string) => key),
  getMessageOr: vi.fn((key: string) => key),
}));

import { createAiDomainPolicySettings } from '../aiDomainPolicySettings.js';
import { StorageKeys } from '../../../utils/storage/types.js';

describe('aiDomainPolicySettings', () => {
  beforeEach(() => {
    vi.resetModules();
    setupDOM();
    mockGetAll.mockReset();
    mockSetAll.mockReset();
    mockShowStatus.mockReset();
    mockGetAll.mockResolvedValue({ [StorageKeys.AI_DOMAIN_POLICY]: {} });
  });

  it('fills the policy select with the three policies', async () => {
    const controller = createAiDomainPolicySettings();
    controller.init();
    await controller.loadAiDomainPolicies();
    const options = Array.from(document.querySelectorAll('#aiDomainPolicySelect option'));
    expect(options.map(o => (o as HTMLOptionElement).value)).toEqual(['allowed', 'no-summary', 'mask-required']);
  });

  it('renders persisted rows from the saved map', async () => {
    mockGetAll.mockResolvedValue({
      [StorageKeys.AI_DOMAIN_POLICY]: { 'example.com': 'no-summary' },
    });
    const controller = createAiDomainPolicySettings();
    await controller.loadAiDomainPolicies();
    const rows = document.querySelectorAll('#aiDomainPolicyList .ai-domain-policy-row');
    expect(rows.length).toBe(1);
    expect(rows[0]?.querySelector('.ai-domain-policy-domain')?.textContent).toBe('example.com');
  });

  it('adds a policy and persists the map', async () => {
    const controller = createAiDomainPolicySettings();
    controller.init();
    const input = document.getElementById('aiDomainPolicyInput') as HTMLInputElement;
    const select = document.getElementById('aiDomainPolicySelect') as HTMLSelectElement;
    input.value = 'example.com';
    select.value = 'mask-required';
    (document.getElementById('aiDomainPolicyAddBtn') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(mockSetAll).toHaveBeenCalled();
    });
    expect(mockSetAll).toHaveBeenCalledWith({
      [StorageKeys.AI_DOMAIN_POLICY]: { 'example.com': 'mask-required' },
    });
  });

  it('rejects an invalid domain without persisting', async () => {
    const controller = createAiDomainPolicySettings();
    controller.init();
    const input = document.getElementById('aiDomainPolicyInput') as HTMLInputElement;
    input.value = 'not a domain!!';
    (document.getElementById('aiDomainPolicyAddBtn') as HTMLButtonElement).click();
    // The rejection is synchronous: settle the click handler's microtasks, then
    // assert the error is shown and nothing was persisted.
    await drainMacrotask();
    expect(document.getElementById('aiDomainPolicyError')?.textContent).not.toBe('');
    expect(mockSetAll).not.toHaveBeenCalled();
  });

  it('removes a policy and persists the map without it', async () => {
    mockGetAll.mockResolvedValue({
      [StorageKeys.AI_DOMAIN_POLICY]: { 'example.com': 'allowed', 'other.com': 'no-summary' },
    });
    const controller = createAiDomainPolicySettings();
    await controller.loadAiDomainPolicies();
    const removeBtn = document.querySelector('[data-domain="example.com"] .ai-domain-policy-remove') as HTMLButtonElement;
    removeBtn.click();
    await vi.waitFor(() => {
      expect(mockSetAll).toHaveBeenCalled();
    });
    expect(mockSetAll).toHaveBeenCalledWith({
      [StorageKeys.AI_DOMAIN_POLICY]: { 'other.com': 'no-summary' },
    });
  });
});
