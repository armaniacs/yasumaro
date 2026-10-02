// @vitest-environment jsdom
/**
 * reopenWizard() used to build a MutationObserver on every click and never
 * disconnect it, so N reopens left N live observers watching the same element.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installTestSecretKek } from '../../../../utils/crypto/__tests__/secretKekHelper.js';
import { waitForMock } from '../../../../../testDir/waitPolicy.js';
import { createGeneralSettingsPanel } from '../generalSettingsPanel.js';

const RealMutationObserver = globalThis.MutationObserver;
let constructions = 0;
const live = new Set<CountingMutationObserver>();

/** Counts constructions and tracks which instances are observing. */
class CountingMutationObserver {
  private readonly inner: MutationObserver;

  constructor(callback: MutationCallback) {
    constructions++;
    this.inner = new RealMutationObserver(callback);
  }

  observe(target: Element, options?: MutationObserverInit): void {
    this.inner.observe(target, options);
    live.add(this);
  }

  disconnect(): void {
    this.inner.disconnect();
    live.delete(this);
  }

  takeRecords(): MutationRecord[] {
    return this.inner.takeRecords();
  }
}

const WIZARD_SECTION = `
  <div id="panel-general">
    <button id="reopenWizardBtn"></button>
    <button id="reopenWizardBtnTop"></button>
  </div>
  <div id="wizardBackdrop" style="display: none"></div>
  <div id="onboardingWizard" class="wizard hidden">
    <h2 id="wizardTitle"></h2>
    <div class="wizard-step" data-step="type">
      <button class="wizard-option" data-type="minimal">Minimal</button>
    </div>
  </div>`;

function reopen(): void {
  (document.getElementById('reopenWizardBtn') as HTMLButtonElement).click();
}

beforeEach(async () => {
  vi.stubGlobal('MutationObserver', CountingMutationObserver);
  await installTestSecretKek();
  document.body.innerHTML = WIZARD_SECTION;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('generalSettingsPanel — wizard backdrop observer', () => {
  it('N reopens, and a re-mount, leave exactly one observer', async () => {
    const first = createGeneralSettingsPanel();
    await first.mount(document.getElementById('panel-general')!);
    for (let i = 0; i < 5; i++) reopen();
    expect(live.size).toBe(1);
    expect(constructions).toBe(1);

    const second = createGeneralSettingsPanel();
    await second.mount(document.getElementById('panel-general')!);
    for (let i = 0; i < 3; i++) reopen();
    expect(live.size).toBe(1);
    expect(constructions).toBe(1);
  });

  it('still syncs the backdrop on class changes after repeated reopens', async () => {
    const panel = createGeneralSettingsPanel();
    await panel.mount(document.getElementById('panel-general')!);
    for (let i = 0; i < 3; i++) reopen();

    const wizard = document.getElementById('onboardingWizard')!;
    const backdrop = document.getElementById('wizardBackdrop') as HTMLElement;
    expect(backdrop.style.display).toBe('block');

    wizard.classList.add('hidden');
    await waitForMock(() => expect(backdrop.style.display).toBe('none'));

    wizard.classList.remove('hidden');
    await waitForMock(() => expect(backdrop.style.display).toBe('block'));
  });
});
