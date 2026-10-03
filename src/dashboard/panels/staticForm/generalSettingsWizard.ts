/**
 * generalSettingsWizard.ts
 * Onboarding wizard reopen wiring for the general settings panel.
 * The class observer is a module-level singleton reused by every reopen and
 * every re-mount — a fresh MutationObserver per click stacked up on the same
 * element, so the singleton deliberately outlives panel instances.
 */

import { initOnboardingWizard } from '../../../utils/ui/onboardingWizard.js';

const WIZARD_CLASS_OBSERVER_INIT: MutationObserverInit = { attributes: true, attributeFilter: ['class'] };

let wizardClassObserver: MutationObserver | null = null;
let wizardClassObserverTarget: Element | null = null;

function syncWizardBackdrop(): void {
  const backdropNow = document.getElementById('wizardBackdrop');
  const wizardNow = document.getElementById('onboardingWizard');
  if (backdropNow) backdropNow.style.display = wizardNow?.classList.contains('hidden') ? 'none' : 'block';
}

/**
 * One observer for the wizard's class attribute, reused by every reopen. A
 * fresh MutationObserver per click stacked up on the same element — nothing
 * ever disconnected them, so N reopens meant N live observers.
 */
function observeWizardClasses(wizardEl: Element): void {
  if (wizardClassObserverTarget !== wizardEl) {
    wizardClassObserver?.disconnect();
    wizardClassObserverTarget = wizardEl;
  }
  if (!wizardClassObserver) wizardClassObserver = new MutationObserver(syncWizardBackdrop);
  wizardClassObserver.observe(wizardEl, WIZARD_CLASS_OBSERVER_INIT);
}

export function mountWizardReopen(container: HTMLElement): void {
  const observeWizard = () => {
    const wizardEl = document.getElementById('onboardingWizard');
    const backdropEl = document.getElementById('wizardBackdrop');
    if (wizardEl && backdropEl) {
      observeWizardClasses(wizardEl);
    }
  };
  const reopenWizard = () => {
    const wizard = document.getElementById('onboardingWizard');
    if (wizard) {
      delete wizard.dataset.initialized;
    }
    initOnboardingWizard(true);
    observeWizard();
    syncWizardBackdrop();
  };
  container.querySelector('#reopenWizardBtn')?.addEventListener('click', reopenWizard);
  container.querySelector('#reopenWizardBtnTop')?.addEventListener('click', reopenWizard);
}
