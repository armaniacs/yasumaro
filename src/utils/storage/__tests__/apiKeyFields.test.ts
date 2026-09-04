import { describe, it, expect } from 'vitest';
import { API_KEY_FIELD_NAMES, isApiKeyField } from '../apiKeyFields.js';
import { API_KEY_FIELDS } from '../settingsMigration.js';
import { redactSettingsApiKeys } from '../storagePort.js';

describe('apiKeyFields SSOT', () => {
  it('migration list matches the canonical list', () => {
    expect([...API_KEY_FIELDS]).toEqual([...API_KEY_FIELD_NAMES]);
  });

  it('matches normalized field detection used by redaction', () => {
    for (const field of API_KEY_FIELD_NAMES) {
      expect(isApiKeyField(field)).toBe(true);
      expect(isApiKeyField(field.toUpperCase())).toBe(true);
    }
    expect(isApiKeyField('some_other_setting')).toBe(false);
  });

  it('redactSettingsApiKeys empties every canonical field', () => {
    const settings = Object.fromEntries(
      API_KEY_FIELD_NAMES.map((f) => [f, 'secret-value']),
    );
    const redacted = redactSettingsApiKeys(settings as never) as Record<string, unknown>;
    for (const field of API_KEY_FIELD_NAMES) {
      expect(redacted[field]).toBe('');
    }
  });
});
