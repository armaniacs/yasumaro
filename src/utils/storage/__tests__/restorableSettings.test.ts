/**
 * restorableSettings.test.ts
 * PBI 2026-07-09-08: allowlist + type/range validation for encrypted backup restore.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../logger.js', () => ({
  addLog: vi.fn(),
  LogType: { DEBUG: 'DEBUG', WARN: 'WARN', INFO: 'INFO', ERROR: 'ERROR' },
}));

import { validateRestorableSettings } from '../restorableSettings.js';

describe('validateRestorableSettings', () => {
  it('passes through a valid allowlisted value unchanged', () => {
    const { sanitized, skippedKeys } = validateRestorableSettings({
      obsidian_enabled: true,
    });

    expect(sanitized.obsidian_enabled).toBe(true);
    expect(skippedKeys).toEqual([]);
  });

  it('removes keys not present in the allowlist', () => {
    const { sanitized, skippedKeys } = validateRestorableSettings({
      some_unknown_future_key: 'x',
    });

    expect(sanitized).not.toHaveProperty('some_unknown_future_key');
    expect(skippedKeys).toEqual(['some_unknown_future_key']);
  });

  it('removes a value whose type does not match the expected type', () => {
    const { sanitized, skippedKeys } = validateRestorableSettings({
      sqlite_retention_days: 'not-a-number',
    });

    expect(sanitized).not.toHaveProperty('sqlite_retention_days');
    expect(skippedKeys).toEqual(['sqlite_retention_days']);
  });

  it('removes a numeric cleansing value that is out of the allowed range', () => {
    const { sanitized, skippedKeys } = validateRestorableSettings({
      ai_summary_cleansing_link_ratio_threshold: 999999,
    });

    expect(sanitized).not.toHaveProperty('ai_summary_cleansing_link_ratio_threshold');
    expect(skippedKeys).toEqual(['ai_summary_cleansing_link_ratio_threshold']);
  });

  it('keeps a numeric cleansing value within the allowed range', () => {
    const { sanitized, skippedKeys } = validateRestorableSettings({
      ai_summary_cleansing_link_ratio_threshold: 50,
    });

    expect(sanitized.ai_summary_cleansing_link_ratio_threshold).toBe(50);
    expect(skippedKeys).toEqual([]);
  });

  it('removes a cleansing boolean flag whose value is not a boolean', () => {
    const { sanitized, skippedKeys } = validateRestorableSettings({
      ai_summary_cleansing_enabled: 'yes',
    });

    expect(sanitized).not.toHaveProperty('ai_summary_cleansing_enabled');
    expect(skippedKeys).toEqual(['ai_summary_cleansing_enabled']);
  });

  it('never restores sensitive API key / PAT fields even if present in the payload', () => {
    const { sanitized, skippedKeys } = validateRestorableSettings({
      obsidian_api_key: 'sk-stolen-key',
      gemini_api_key: 'sk-stolen-key-2',
      openai_api_key: 'sk-stolen-key-3',
      openai_2_api_key: 'sk-stolen-key-4',
      provider_api_key: 'sk-stolen-key-5',
      github_pat: 'ghp_stolentoken',
    });

    expect(sanitized).not.toHaveProperty('obsidian_api_key');
    expect(sanitized).not.toHaveProperty('gemini_api_key');
    expect(sanitized).not.toHaveProperty('openai_api_key');
    expect(sanitized).not.toHaveProperty('openai_2_api_key');
    expect(sanitized).not.toHaveProperty('provider_api_key');
    expect(sanitized).not.toHaveProperty('github_pat');
    expect(skippedKeys).toEqual(
      expect.arrayContaining([
        'obsidian_api_key',
        'gemini_api_key',
        'openai_api_key',
        'openai_2_api_key',
        'provider_api_key',
        'github_pat',
      ])
    );
  });

  it('processes a mixed payload, keeping valid keys and skipping the rest', () => {
    const { sanitized, skippedKeys } = validateRestorableSettings({
      obsidian_enabled: true,
      sqlite_retention_days: 30,
      openai_api_key: 'sk-should-not-restore',
      unknown_key: 'x',
    });

    expect(sanitized.obsidian_enabled).toBe(true);
    expect(sanitized.sqlite_retention_days).toBe(30);
    expect(sanitized).not.toHaveProperty('openai_api_key');
    expect(sanitized).not.toHaveProperty('unknown_key');
    expect(skippedKeys.sort()).toEqual(['openai_api_key', 'unknown_key'].sort());
  });

  it('returns empty sanitized settings and no skipped keys for an empty payload', () => {
    const { sanitized, skippedKeys } = validateRestorableSettings({});

    expect(sanitized).toEqual({});
    expect(skippedKeys).toEqual([]);
  });
});
