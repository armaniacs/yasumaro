// @vitest-environment jsdom
/**
 * Unit tests for the wizard reopen module (PBI 2026-10-03-29): the module
 * mounts independently of the panel and keeps the class observer as a
 * module-level singleton — a fresh MutationObserver per reopen stacked up on
 * the same element, so N reopens and a re-mount must leave exactly one.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { waitForMock } from '../../../../../testDir/waitPolicy.js';
import { mountWizardReopen } from '../generalSettingsWizard.js';

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

beforeEach(() => {
  vi.stubGlobal('MutationObserver', CountingMutationObserver);
  document.body.innerHTML = WIZARD_SECTION;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('generalSettingsWizard — module independence', () => {
  it('N reopens, and a re-mount, leave exactly one observer', () => {
    mountWizardReopen(document.getElementById('panel-general')!);
    for (let i = 0; i < 5; i++) {
      (document.getElementById('reopenWizardBtn') as HTMLButtonElement).click();
    }
    expect(live.size).toBe(1);
    expect(constructions).toBe(1);

    mountWizardReopen(document.getElementById('panel-general')!);
    for (let i = 0; i < 3; i++) {
      (document.getElementById('reopenWizardBtnTop') as HTMLButtonElement).click();
    }
    expect(live.size).toBe(1);
    expect(constructions).toBe(1);
  });

  it('both reopen buttons sync the backdrop on class changes', async () => {
    mountWizardReopen(document.getElementById('panel-general')!);
    (document.getElementById('reopenWizardBtnTop') as HTMLButtonElement).click();

    const wizard = document.getElementById('onboardingWizard')!;
    const backdrop = document.getElementById('wizardBackdrop') as HTMLElement;
    expect(backdrop.style.display).toBe('block');

    wizard.classList.add('hidden');
    await waitForMock(() => expect(backdrop.style.display).toBe('none'));

    wizard.classList.remove('hidden');
    await waitForMock(() => expect(backdrop.style.display).toBe('block'));
  });
});
