/**
 * SettingsSchema: a declarative mapping from StorageKeys to DOM elements.
 *
 * Each field describes:
 * - key: the StorageKeys constant value (compile-time checked)
 * - type: the HTML input type for extraction/validation
 *
 * The selector is derived automatically from the key via the
 * `[data-storage-key="..."]` convention — no manual selector needed.
 *
 * When a schema is provided to loadSettingsToInputs / extractSettingsFromInputs,
 * it iterates the schema instead of querying all [data-storage-key] elements.
 * Without a schema, the functions fall back to the legacy attribute scan.
 */
import type { StorageKeys as StorageKeysType } from './storage/types.js';
type StorageKey = (typeof StorageKeysType)[keyof typeof StorageKeysType];

export interface SettingsFieldConfig {
  /** StorageKeys constant value — must be a valid storage key. */
  key: StorageKey;
  /** HTML input type for extraction and validation. */
  type: 'text' | 'checkbox' | 'number' | 'select' | 'password';
  /** Optional validation rule. Returns an error message string on failure, null on success. */
  validate?: (value: unknown) => string | null;
}

export type SettingsSchema = SettingsFieldConfig[];

/**
 * Validation field config: maps a StorageKey to its DOM element ID and error
 * element ID. Used by settingsPipeline.ts to replace hardcoded element lookups.
 */
export interface ValidationFieldConfig {
  /** StorageKeys constant value for type-safe reference. */
  storageKey: StorageKey;
  /** DOM element ID (used by getElementById for validation inputs). */
  elementId: string;
  /** Error message element ID. */
  errorId: string;
}

export type ValidationSchema = ValidationFieldConfig[];

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

/**
 * Provider connection fields (base URL / model / API key). An empty value in
 * one of these on save almost always means "the input was never populated"
 * (a UI-desync bug), not "the user wants it blank" — these keys have working
 * defaults and are set once. Callers must NOT overwrite a non-empty stored
 * value with an empty extracted one for these keys. Guarded at the save
 * orchestration layer where the current stored value is available.
 */
const PROVIDER_CONNECTION_FIELD_PATTERN = /_(base_url|model|api_key)$/i;
export function isProviderConnectionField(key: string): boolean {
  return PROVIDER_CONNECTION_FIELD_PATTERN.test(key);
}

function isMaskedValue(value: string): boolean {
  return value === '' || MASKED_PLACEHOLDER_PATTERN.test(value);
}

/**
 * Derive a CSS selector from a StorageKeys value.
 * Convention: `[data-storage-key="<key>"]`.
 */
function selectorForKey(key: string): string {
  return `[data-storage-key="${key}"]`;
}

/**
 * Load settings values into form elements.
 *
 * When a schema is provided, iterates the schema fields for type-safe access.
 * Without a schema, falls back to scanning all [data-storage-key] attributes
 * (legacy behavior, backward compatible).
 */
export function loadSettingsToInputs(
  container: HTMLElement,
  settings: Record<string, unknown>,
  schema?: SettingsSchema,
): void {
  if (schema) {
    for (const field of schema) {
      const element = container.querySelector<HTMLElement>(selectorForKey(field.key));
      if (!element) continue;

      const value = settings[field.key];

      if (isApiKeyField(field.key) && element instanceof HTMLInputElement && element.type === 'password') {
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
    return;
  }

  // Legacy path: scan all [data-storage-key] attributes
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

/**
 * Extract settings values from form elements.
 *
 * When a schema is provided, iterates the schema fields for type-safe access.
 * Without a schema, falls back to scanning all [data-storage-key] attributes.
 */
export function extractSettingsFromInputs(
  container: HTMLElement,
  schema?: SettingsSchema,
): Record<string, unknown> {
  const settings: Record<string, unknown> = {};

  if (schema) {
    for (const field of schema) {
      const element = container.querySelector<HTMLElement>(selectorForKey(field.key));
      if (!element) continue;

      let value = getInputValue(element);
      if (typeof value === 'string') value = value.trim();

      if (isApiKeyField(field.key) && (value === '' || isMaskedValue(String(value)))) continue;

      settings[field.key] = value;
    }
    return settings;
  }

  // Legacy path
  const elements = container.querySelectorAll<HTMLElement>('[data-storage-key]');
  for (const element of elements) {
    const key = element.getAttribute('data-storage-key');
    if (!key) continue;

    let value = getInputValue(element);
    if (typeof value === 'string') value = value.trim();

    if (isApiKeyField(key) && (value === '' || isMaskedValue(String(value)))) continue;

    settings[key] = value;
  }

  return settings;
}

/**
 * Read the LOCAL_MARKDOWN_EXPORT_TIMING radio group's checked value.
 */
export function extractLocalMarkdownExportTiming(): string | undefined {
  const radios = document.querySelectorAll<HTMLInputElement>('input[name="localMarkdownExportTiming"]');
  if (!radios.length) return undefined;
  for (const radio of radios) {
    if (radio.checked) return radio.value;
  }
  return undefined;
}

/**
 * Apply a LOCAL_MARKDOWN_EXPORT_TIMING value to the radio group.
 */
export function loadLocalMarkdownExportTiming(timing: string | undefined): void {
  const radios = document.querySelectorAll<HTMLInputElement>('input[name="localMarkdownExportTiming"]');
  if (!radios.length) return;
  for (const radio of radios) {
    radio.checked = radio.value === timing;
  }
}
