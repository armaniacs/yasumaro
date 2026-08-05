import { describe, it, expect } from 'vitest';
import { redactSettingsApiKeys } from '../recordingLogic.js';

describe('redactSettingsApiKeys (VULN-014)', () => {
  it('returns a copy with every API key field emptied', () => {
    const settings = {
      openai_api_key: 'sk-openai',
      obsidian_api_key: 'obs-123',
      gemini_api_key: 'gem-456',
      github_pat: 'ghp_789',
      provider_api_key: 'prov-abc',
      openai_2_api_key: 'sk-2',
      theme: 'dark',
      obsidian_vault_path: '/vault',
    } as any;

    const redacted = redactSettingsApiKeys(settings);

    expect(redacted).not.toBe(settings);
    expect(redacted.openai_api_key).toBe('');
    expect(redacted.obsidian_api_key).toBe('');
    expect(redacted.gemini_api_key).toBe('');
    expect(redacted.github_pat).toBe('');
    expect(redacted.provider_api_key).toBe('');
    expect(redacted.openai_2_api_key).toBe('');
    // Non-secret fields are preserved.
    expect(redacted.theme).toBe('dark');
    expect(redacted.obsidian_vault_path).toBe('/vault');
  });

  it('does not mutate the original settings object', () => {
    const settings = { openai_api_key: 'sk-openai', theme: 'dark' } as any;
    redactSettingsApiKeys(settings);
    expect(settings.openai_api_key).toBe('sk-openai');
    expect(settings.theme).toBe('dark');
  });

  it('handles null input', () => {
    expect(redactSettingsApiKeys(null)).toBeNull();
  });
});
