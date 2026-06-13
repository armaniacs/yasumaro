export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  dangerous?: boolean;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function t(key: string, fallback: string, substitutions?: string | string[]): string {
  let subs: string | undefined;
  if (Array.isArray(substitutions)) {
    subs = substitutions.join(' ');
  } else if (typeof substitutions === 'string') {
    subs = substitutions;
  }

  const message = subs !== undefined
    ? chrome.i18n.getMessage(key, subs)
    : chrome.i18n.getMessage(key);
  return message || fallback;
}

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

export function showConfirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const previousActiveElement = document.activeElement as HTMLElement | null;
    const overlay = document.createElement('div');
    const dialog = document.createElement('div');
    const title = document.createElement('h2');
    const message = document.createElement('p');
    const actions = document.createElement('div');
    const cancel = document.createElement('button');
    const confirm = document.createElement('button');

    overlay.className = 'confirm-dialog-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'confirm-dialog-title');
    overlay.setAttribute('aria-describedby', 'confirm-dialog-message');

    dialog.className = options.dangerous
      ? 'confirm-dialog confirm-dialog-danger'
      : 'confirm-dialog';

    title.id = 'confirm-dialog-title';
    title.textContent = options.title;

    message.id = 'confirm-dialog-message';
    message.textContent = options.message;

    actions.className = 'confirm-dialog-actions';

    cancel.type = 'button';
    cancel.className = 'confirm-dialog-btn confirm-dialog-btn-cancel';
    cancel.textContent = t('cancel', 'Cancel', options.cancelLabel);

    confirm.type = 'button';
    confirm.className = options.dangerous
      ? 'confirm-dialog-btn confirm-dialog-btn-danger'
      : 'confirm-dialog-btn confirm-dialog-btn-primary';
    confirm.textContent = t('confirmDelete', 'Delete', options.confirmLabel);

    actions.append(cancel, confirm);
    dialog.append(title, message, actions);
    overlay.append(dialog);

    const cleanup = (confirmed: boolean) => {
      document.removeEventListener('keydown', handleKeydown);
      overlay.remove();
      previousActiveElement?.focus();
      resolve(confirmed);
    };

    function handleKeydown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        cleanup(false);
        return;
      }
      trapFocus(event, dialog);
    }

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        cleanup(false);
      }
    });
    cancel.addEventListener('click', () => cleanup(false));
    confirm.addEventListener('click', () => cleanup(true));

    document.addEventListener('keydown', handleKeydown);
    document.body.appendChild(overlay);
    confirm.focus();
  });
}
