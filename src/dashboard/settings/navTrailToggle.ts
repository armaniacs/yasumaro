/**
 * navTrailToggle.ts
 * The opt-in switch for navigation-trail recording (PBI 2026-09-26-03).
 *
 * WHY the checkbox reverts before the dialog: the confirm dialog is modal, and
 * a checked box sitting behind it reads as "already on" if the user cancels.
 * Setting it back first means the rendered state always matches stored state.
 *
 * WHY no `data-storage-key`: the generic schema binding would persist the
 * checkbox on change without asking, which is the opposite of a consent gate.
 */

import { showConfirmDialog } from '../../utils/ui/confirmDialog.js';
import { getMessageOr } from '../../utils/i18n.js';
import {
  disableNavTrail,
  enableNavTrail,
  getNavTrailConsent,
  isNavTrailActive,
} from '../../utils/storage/navTrailConsent.js';

export async function initNavTrailToggle(container: HTMLElement): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('#navTrailEnabled');
  if (!input) {
    return;
  }
  const status = container.querySelector<HTMLElement>('#navTrailStatus');

  let before = isNavTrailActive(await getNavTrailConsent());
  input.checked = before;

  input.addEventListener('change', () => {
    void (async () => {
      const wanted = input.checked;
      // Revert immediately: from here on the checkbox mirrors the dialog's
      // outcome, not the user's raw click.
      input.checked = before;

      if (!wanted) {
        try {
          await disableNavTrail();
          input.checked = false;
          before = false;
        } catch (error) {
          if (status) {
            status.textContent = getMessageOr(
              'navTrailSaveFailed',
              'Could not save the setting.',
            );
          }
          console.error('[navTrailToggle] disable failed:', error);
        }
        return;
      }

      const ok = await showConfirmDialog({
        title: getMessageOr('navTrailConsentTitle', 'Enable navigation trail?'),
        message: getMessageOr('navTrailConsentMessage', ''),
        confirmLabel: getMessageOr('navTrailConsentAccept', 'Enable'),
        cancelLabel: getMessageOr('cancel', 'Cancel'),
      });
      if (!ok) {
        return;
      }

      try {
        await enableNavTrail(Date.now());
        input.checked = true;
        before = true;
        if (status) status.textContent = '';
      } catch (error) {
        if (status) {
          status.textContent = getMessageOr('navTrailSaveFailed', 'Could not save the setting.');
        }
        console.error('[navTrailToggle] enable failed:', error);
      }
    })();
  });
}
