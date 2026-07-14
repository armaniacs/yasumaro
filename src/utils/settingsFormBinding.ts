const API_KEY_PATTERN = /_api_key$/i;
const MASKED_PLACEHOLDER_PATTERN = /^\u25cf+$/;

function getInputValue(element: Element): unknown {
  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox') return element.checked;
    if (element.type === 'number') return element.value === '' ? '' : Number(element.value);
    return element.value;
  }
  if (element instanceof HTMLSelectElement) return element.value;
  if (element instanceof HTMLTextAreaElement) return element.value;
  return (element as HTMLInputElement).value;
}

function isApiKeyField(key: string): boolean {
  return API_KEY_PATTERN.test(key);
}

function isMaskedValue(value: string): boolean {
  return value === '' || MASKED_PLACEHOLDER_PATTERN.test(value);
}

export function loadSettingsToInputs(container: HTMLElement, settings: Record<string, unknown>): void {
  const elements = container.querySelectorAll<HTMLElement>('[data-storage-key]');
  for (const element of elements) {
    const key = element.getAttribute('data-storage-key');
    if (!key) continue;

    const value = settings[key];

    if (isApiKeyField(key) && element instanceof HTMLInputElement && element.type === 'password') {
      if (value && value !== '') {
        element.placeholder = '\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf (Already set)';

        element.value = '';
      }
      continue;
    }

    if (value !== undefined && value !== null) {
      if (element instanceof HTMLInputElement && element.type === 'checkbox') {
        element.checked = !!value;
      } else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        element.value = String(value);
      }
    }
  }
}

export function extractSettingsFromInputs(container: HTMLElement): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  const elements = container.querySelectorAll<HTMLElement>('[data-storage-key]');

  for (const element of elements) {
    const key = element.getAttribute('data-storage-key');
    if (!key) continue;

    let value = getInputValue(element);

    if (typeof value === 'string') {
      value = value.trim();
    }

    if (isApiKeyField(key) && (value === '' || isMaskedValue(String(value)))) {
      continue;
    }

    settings[key] = value;
  }

  return settings;
}
