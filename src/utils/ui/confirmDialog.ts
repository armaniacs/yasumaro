// @layer 1 — Infrastructure: accessible dialog seam (dashboard + popup shared)
/**
 * ui/confirmDialog.ts
 * Accessible confirm/alert dialog seam — the single replacement for native
 * `confirm()` / `alert()` (DESIGN_SPECIFICATIONS §4.1: modals trap focus,
 * close on Escape, and restore focus to the invoker).
 *
 * Promoted from dashboard/utils (PBI 2026-09-17-19) so popup and dashboard
 * share one implementation instead of native dialogs.
 */

import { getMessageOr } from '../i18n.js';

export interface ConfirmDialogOptions {
  /** Optional — when omitted the dialog renders the message only. */
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  dangerous?: boolean;
}

export interface AlertDialogOptions {
  /** Optional — when omitted the dialog renders the message only. */
  title?: string;
  message: string;
  okLabel?: string;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function trapFocus(event: KeyboardEvent, dialog: HTMLElement): void {
  if (event.key !== 'Tab') return;

  const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  if (focusable.length === 0) return;

  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

interface ButtonSpec {
  label: string;
  className: string;
  /** Value passed to the resolver when this button is clicked. */
  resolves: boolean;
}

/** Builds the overlay, wires focus trap + Escape + overlay-click dismissal,
 *  and hands every exit path to `onResolve`. The last button receives focus. */
function openModalDialog(options: {
  title?: string;
  message: string;
  role: 'dialog' | 'alertdialog';
  dangerous?: boolean;
  buttons: ButtonSpec[];
  onResolve: (value: boolean) => void;
}): void {
  const previousActiveElement = document.activeElement as HTMLElement | null;
  const overlay = document.createElement('div');
  const dialog = document.createElement('div');
  const title = document.createElement('h2');
  const message = document.createElement('p');
  const actions = document.createElement('div');

  overlay.className = 'confirm-dialog-overlay';
  overlay.setAttribute('role', options.role);
  overlay.setAttribute('aria-modal', 'true');
  // Without a title the message doubles as the accessible name.
  overlay.setAttribute('aria-labelledby', options.title ? 'confirm-dialog-title' : 'confirm-dialog-message');
  overlay.setAttribute('aria-describedby', 'confirm-dialog-message');

  dialog.className = options.dangerous
    ? 'confirm-dialog confirm-dialog-danger'
    : 'confirm-dialog';

  if (options.title) {
    title.id = 'confirm-dialog-title';
    title.textContent = options.title;
    dialog.append(title);
  }

  message.id = 'confirm-dialog-message';
  message.textContent = options.message;

  actions.className = 'confirm-dialog-actions';

  const buttons = options.buttons.map((spec) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = spec.className;
    btn.textContent = spec.label;
    btn.addEventListener('click', () => cleanup(spec.resolves));
    return btn;
  });

  actions.append(...buttons);
  dialog.append(message, actions);
  overlay.append(dialog);

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      cleanup(false);
      return;
    }
    trapFocus(event, dialog);
  }

  function cleanup(confirmed: boolean): void {
    document.removeEventListener('keydown', handleKeydown);
    overlay.remove();
    previousActiveElement?.focus();
    options.onResolve(confirmed);
  }

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      cleanup(false);
    }
  });

  document.addEventListener('keydown', handleKeydown);
  document.body.appendChild(overlay);
  buttons[buttons.length - 1]!.focus();
}

export function showConfirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    openModalDialog({
      ...(options.title !== undefined ? { title: options.title } : {}),
      message: options.message,
      role: 'dialog',
      ...(options.dangerous !== undefined ? { dangerous: options.dangerous } : {}),
      buttons: [
        { label: getMessageOr('cancel', 'Cancel', options.cancelLabel), className: 'confirm-dialog-btn confirm-dialog-btn-cancel', resolves: false },
        {
          label: options.confirmLabel || getMessageOr('confirmDelete', 'Delete'),
          className: options.dangerous
            ? 'confirm-dialog-btn confirm-dialog-btn-danger'
            : 'confirm-dialog-btn confirm-dialog-btn-primary',
          resolves: true,
        },
      ],
      onResolve: resolve,
    });
  });
}

/** Informational dialog (native `alert()` replacement): one OK button,
 *  Escape / overlay click / OK all close it. */
export function showAlertDialog(options: AlertDialogOptions): Promise<void> {
  return new Promise<void>((resolve) => {
    openModalDialog({
      ...(options.title !== undefined ? { title: options.title } : {}),
      message: options.message,
      role: 'alertdialog',
      buttons: [
        { label: getMessageOr('ok', 'OK', options.okLabel), className: 'confirm-dialog-btn confirm-dialog-btn-primary', resolves: true },
      ],
      onResolve: () => resolve(),
    });
  });
}
