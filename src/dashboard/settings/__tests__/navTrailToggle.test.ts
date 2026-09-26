// @vitest-environment jsdom
/**
 * navTrailToggle tests: the checkbox may only turn ON through the consent
 * dialog, and a cancel or a save failure must leave the stored state — and the
 * rendered box — off.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockShowConfirmDialog = vi.fn();
const mockGetNavTrailConsent = vi.fn();
const mockEnableNavTrail = vi.fn();
const mockDisableNavTrail = vi.fn();

vi.mock('../../../utils/ui/confirmDialog.js', () => ({
  showConfirmDialog: (...args: unknown[]) => mockShowConfirmDialog(...args),
}));

vi.mock('../../../utils/storage/navTrailConsent.js', () => ({
  getNavTrailConsent: (...args: unknown[]) => mockGetNavTrailConsent(...args),
  enableNavTrail: (...args: unknown[]) => mockEnableNavTrail(...args),
  disableNavTrail: (...args: unknown[]) => mockDisableNavTrail(...args),
  isNavTrailActive: (c: { enabled: boolean; consentedAt: number | null }) =>
    c.enabled && c.consentedAt !== null,
}));

import { initNavTrailToggle } from '../navTrailToggle.js';

const OFF = { enabled: false, consentedAt: null };
const ON = { enabled: true, consentedAt: 1_700_000_000_000 };

function mount() {
  const container = document.createElement('div');
  container.innerHTML = `
    <input type="checkbox" id="navTrailEnabled">
    <div id="navTrailStatus"></div>
  `;
  document.body.appendChild(container);
  return {
    container,
    input: container.querySelector<HTMLInputElement>('#navTrailEnabled')!,
    status: container.querySelector<HTMLElement>('#navTrailStatus')!,
  };
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

/** Clicks the box and lets the async handler settle. */
async function toggle(input: HTMLInputElement, to: boolean): Promise<void> {
  input.checked = to;
  input.dispatchEvent(new Event('change'));
  await flush();
}

describe('initNavTrailToggle', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockShowConfirmDialog.mockReset();
    mockGetNavTrailConsent.mockReset();
    mockEnableNavTrail.mockReset();
    mockDisableNavTrail.mockReset();
    mockGetNavTrailConsent.mockResolvedValue(OFF);
    mockEnableNavTrail.mockResolvedValue(undefined);
    mockDisableNavTrail.mockResolvedValue(undefined);
  });

  it('does nothing when the markup is absent', async () => {
    const empty = document.createElement('div');
    await expect(initNavTrailToggle(empty)).resolves.toBeUndefined();
  });

  it('reflects the stored consent on mount', async () => {
    mockGetNavTrailConsent.mockResolvedValue(ON);
    const { input } = mount();

    await initNavTrailToggle(document.body);

    expect(input.checked).toBe(true);
  });

  it('enables only after the dialog is accepted', async () => {
    mockShowConfirmDialog.mockResolvedValue(true);
    const { container, input } = mount();
    await initNavTrailToggle(container);

    await toggle(input, true);

    expect(mockShowConfirmDialog).toHaveBeenCalledTimes(1);
    expect(mockEnableNavTrail).toHaveBeenCalledTimes(1);
    expect(input.checked).toBe(true);
  });

  it('leaves the feature off when the dialog is cancelled', async () => {
    mockShowConfirmDialog.mockResolvedValue(false);
    const { container, input } = mount();
    await initNavTrailToggle(container);

    await toggle(input, true);

    expect(mockShowConfirmDialog).toHaveBeenCalledTimes(1);
    expect(mockEnableNavTrail).not.toHaveBeenCalled();
    expect(input.checked).toBe(false);
  });

  it('reverts the box while the dialog is open', async () => {
    let seenDuringDialog: boolean | null = null;
    mockShowConfirmDialog.mockImplementation(async () => {
      seenDuringDialog = input?.checked ?? null;
      return false;
    });
    const { container, input } = mount();
    await initNavTrailToggle(container);

    await toggle(input, true);

    // A checked box behind a modal would read as "already on".
    expect(seenDuringDialog).toBe(false);
  });

  it('disables without asking', async () => {
    mockGetNavTrailConsent.mockResolvedValue(ON);
    const { container, input } = mount();
    await initNavTrailToggle(container);

    await toggle(input, false);

    expect(mockShowConfirmDialog).not.toHaveBeenCalled();
    expect(mockDisableNavTrail).toHaveBeenCalledTimes(1);
    expect(input.checked).toBe(false);
  });

  it('keeps the box off and reports when the save fails', async () => {
    mockShowConfirmDialog.mockResolvedValue(true);
    mockEnableNavTrail.mockRejectedValue(new Error('quota'));
    const { container, input, status } = mount();
    await initNavTrailToggle(container);

    await toggle(input, true);

    expect(input.checked).toBe(false);
    expect(status.textContent).not.toBe('');
  });

  it('reports a failed disable and keeps the box on', async () => {
    mockGetNavTrailConsent.mockResolvedValue(ON);
    mockDisableNavTrail.mockRejectedValue(new Error('quota'));
    const { container, input, status } = mount();
    await initNavTrailToggle(container);

    await toggle(input, false);

    expect(input.checked).toBe(true);
    expect(status.textContent).not.toBe('');
  });
});
