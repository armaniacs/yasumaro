/**
 * obsidianHostCredentialPairing.test.ts
 *
 * Regression tests for VULN-001: the stored vault API key must never be
 * paired with an override host. Covers the builder pairing rule, the
 * strengthened host validation, and the saved-origin CSP gate. Uses the
 * exploit test's technique (stored victim key + attacker host) as normal
 * unit tests with the fixed expectations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StorageKeys } from '../storage/types.js';

const store: Record<string, unknown> = vi.hoisted(() => ({}));

vi.mock('../storage/SettingsRepository.js', () => ({
  settingsRepository: {
    get: vi.fn(async (key: string) => store[key]),
    getAll: vi.fn(async () => ({ ...store })),
  },
}));

import { buildObsidianConfig } from '../obsidianConfigBuilder.js';
import { validateObsidianHost } from '../obsidianConfigValidator.js';
import { CSPValidator } from '../cspValidator.js';

beforeEach(() => {
  for (const key of Object.keys(store)) {
    delete store[key];
  }
  CSPValidator.reset();
});

function saveVault(host: string, apiKey: string, protocol = 'https', port = '27124'): void {
  store[StorageKeys.OBSIDIAN_HOST] = host;
  store[StorageKeys.OBSIDIAN_API_KEY] = apiKey;
  store[StorageKeys.OBSIDIAN_PROTOCOL] = protocol;
  store[StorageKeys.OBSIDIAN_PORT] = port;
}

describe('buildFromOverride stored-key pairing rule', () => {
  it('rejects override host with no apiKey instead of falling back to the stored key', async () => {
    saveVault('127.0.0.1', 'VICTIM-VAULT-KEY-12345');
    await expect(
      buildObsidianConfig({ protocol: 'https', host: 'attacker.example', port: '443' }),
    ).rejects.toThrow('API key is missing');
  });

  it('rejects an absent override host when the saved host is remote', async () => {
    saveVault('vault.example.com', 'VAULT-KEY', 'https', '443');
    await expect(buildObsidianConfig({ protocol: 'https', port: '443' })).rejects.toThrow(
      'API key is missing',
    );
  });

  it('fails closed when the saved host itself is invalid', async () => {
    saveVault('bad host!!', 'VAULT-KEY');
    await expect(
      buildObsidianConfig({ protocol: 'https', host: 'attacker.example', port: '443' }),
    ).rejects.toThrow('API key is missing');
  });

  it('honors a typed apiKey with any host (test-before-save carries no stored credential)', async () => {
    saveVault('127.0.0.1', 'VICTIM-VAULT-KEY-12345');
    const config = await buildObsidianConfig({
      protocol: 'https',
      host: 'new-vault.example.com',
      port: '443',
      apiKey: 'TYPED-KEY',
    });
    expect(config.baseUrl).toBe('https://new-vault.example.com:443');
    expect((config.headers as Record<string, string>)['Authorization']).toBe('Bearer TYPED-KEY');
  });

  it('falls back to the stored key when the override host equals the saved host', async () => {
    saveVault('vault.example.com', 'VAULT-KEY', 'https', '443');
    const config = await buildObsidianConfig({
      protocol: 'https',
      host: 'vault.example.com',
      port: '443',
    });
    expect(config.baseUrl).toBe('https://vault.example.com:443');
    expect((config.headers as Record<string, string>)['Authorization']).toBe('Bearer VAULT-KEY');
  });

  it('falls back to the stored key for protocol/port-only edits with an unset saved host', async () => {
    store[StorageKeys.OBSIDIAN_API_KEY] = 'VAULT-KEY';
    const config = await buildObsidianConfig({ protocol: 'https', port: '27124' });
    expect(config.baseUrl).toBe('https://127.0.0.1:27124');
    expect((config.headers as Record<string, string>)['Authorization']).toBe('Bearer VAULT-KEY');
  });
});

describe('validateObsidianHost substantive validation', () => {
  it.each(['localhost', '127.0.0.1', '192.168.1.10', 'example.com', 'vault.example.com'])(
    'accepts legitimate host %s (remote https vaults stay usable)',
    (host) => {
      expect(validateObsidianHost(host)).toBe(host);
    },
  );

  it.each(['::1', '[::1]'])('accepts IPv6 loopback %s bracketed', (host) => {
    expect(validateObsidianHost(host)).toBe('[::1]');
  });

  it.each([
    'has space.com',
    'http://example.com',
    'example.com/path',
    'example.com\\path',
    '127.0.0.1@evil.com',
    'evil.com%2Fpath',
    '-leading-hyphen.com',
    'trailing-hyphen-.com',
    'empty..label.com',
    'under_score.com',
    '999.999.999.999',
    '1.2.3.4.5',
  ])('rejects malformed or redirecting host %s', (host) => {
    expect(() => validateObsidianHost(host)).toThrow(/invalid characters/);
  });
});

describe('saved-Obsidian-origin CSP gate', () => {
  function initSavedVault(host: string, port: string, protocol: string): void {
    CSPValidator.initializeFromSettings({
      [StorageKeys.OBSIDIAN_HOST]: host,
      [StorageKeys.OBSIDIAN_PORT]: port,
      [StorageKeys.OBSIDIAN_PROTOCOL]: protocol,
      conditional_csp_providers: [],
    });
  }

  it('passes the saved remote origin while blocking an unsaved remote origin', () => {
    initSavedVault('vault.example.com', '443', 'https');
    expect(CSPValidator.isUrlAllowed('https://vault.example.com:443/')).toBe(true);
    expect(CSPValidator.isUrlAllowed('https://attacker.example:443/')).toBe(false);
  });

  it('passes a saved loopback vault on a custom port outside the generic allowlist', () => {
    initSavedVault('127.0.0.1', '9999', 'http');
    expect(CSPValidator.isUrlAllowed('http://127.0.0.1:9999/')).toBe(true);
    expect(CSPValidator.isUrlAllowed('http://127.0.0.1:9998/')).toBe(false);
  });

  it('an invalid saved host contributes no origin (unsaved remotes stay blocked)', () => {
    initSavedVault('not a host!!', '443', 'https');
    expect(CSPValidator.isUrlAllowed('https://attacker.example:443/')).toBe(false);
  });

  it('without saved obsidian settings, unsaved remote origins stay blocked', () => {
    CSPValidator.initializeFromSettings({ conditional_csp_providers: [] });
    expect(CSPValidator.isUrlAllowed('https://attacker.example:443/')).toBe(false);
  });
});
