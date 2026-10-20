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
import { validateObsidianHost, baseUrlAgreesWithUrlParser } from '../obsidianConfigValidator.js';
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

  // PBI-14: parser-differential guard. The WHATWG URL parser reinterprets
  // hex-encoded IPv4 labels as 127.0.0.1 while the validator saw a DNS name,
  // so the resolved hostname disagreeing with the approved string is the
  // rejection criterion itself (test-first form of the PBI's scenario 3).
  it.each(['0x7f000001', '0x7f.0.0.1', '0X7F.0.0.1', '0x7f.0x0.0.1'])(
    'rejects hex-encoded IPv4 host %s the URL parser resolves to 127.0.0.1',
    (host) => {
      expect(new URL(`https://${host}/`).hostname).toBe('127.0.0.1');
      expect(() => validateObsidianHost(host)).toThrow(/invalid characters/);
    },
  );

  // Audit-correction regression pin: the pure-decimal and 4-digit-octal forms
  // were ALREADY rejected by the digit-dot guard before PBI-14 (audit
  // correction to the hunter evidence). They are not new PBI-14 rejections.
  it.each(['2130706433', '0177.0.0.1'])(
    'still rejects %s via the pre-existing digit-dot guard (audit-correction pin)',
    (host) => {
      expect(() => validateObsidianHost(host)).toThrow(/invalid characters/);
    },
  );

  // False-positive guard: the parser never reinterprets the nip.io form, so
  // the whole-host criterion (not a per-label "0x" check) keeps it usable.
  it('accepts 0x7f000001.nip.io (never reinterpreted by the URL parser)', () => {
    expect(new URL('https://0x7f000001.nip.io/').hostname).toBe('0x7f000001.nip.io');
    expect(validateObsidianHost('0x7f000001.nip.io')).toBe('0x7f000001.nip.io');
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

  // PBI-14: before the fix the derivation resolved the hex host to
  // 127.0.0.1 and let the gate allow that parser-resolved origin. The
  // strengthened validator throws instead, so savedObsidianOrigins stays the
  // empty set and the port-9999 origin (outside the generic loopback
  // allowlist) stays blocked.
  it('a hex-encoded saved host contributes no origin (gate stays closed)', () => {
    initSavedVault('0x7f000001', '9999', 'https');
    expect(CSPValidator.isUrlAllowed('https://127.0.0.1:9999/')).toBe(false);
    expect(CSPValidator.isUrlAllowed('https://attacker.example:443/')).toBe(false);
  });
});

describe('encoded-host config building (PBI-14)', () => {
  it('buildFromSettings returns no baseUrl for a saved hex host (Bearer never built, no fetch)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      saveVault('0x7f000001', 'VAULT-KEY');
      await expect(buildObsidianConfig()).rejects.toThrow(/invalid characters/);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('buildFromOverride rejects a hex connection-test host with the same judgment', async () => {
    saveVault('127.0.0.1', 'VAULT-KEY');
    await expect(
      buildObsidianConfig({ protocol: 'https', host: '0x7f.0.0.1', port: '443', apiKey: 'TYPED-KEY' }),
    ).rejects.toThrow(/invalid characters/);
  });

  // Second layer: the builder-side parser-agreement gate itself. Reachable
  // without bypassing the validator because the gate is a pure function.
  it('baseUrl parser-agreement gate refuses a hex origin whose resolution differs', () => {
    expect(baseUrlAgreesWithUrlParser('https://0x7f.0.0.1:27124', '0x7f.0.0.1')).toBe(false);
    expect(baseUrlAgreesWithUrlParser('https://0x7f000001:27124', '0x7f000001')).toBe(false);
    expect(baseUrlAgreesWithUrlParser('https://0X7F.0.0.1:27124', '0X7F.0.0.1')).toBe(false);
  });

  it('baseUrl parser-agreement gate keeps regular hosts agreeable', () => {
    expect(baseUrlAgreesWithUrlParser('https://127.0.0.1:27124', '127.0.0.1')).toBe(true);
    expect(baseUrlAgreesWithUrlParser('https://localhost:27124', 'localhost')).toBe(true);
    expect(baseUrlAgreesWithUrlParser('https://[::1]:27124', '[::1]')).toBe(true);
    expect(baseUrlAgreesWithUrlParser('https://192.168.1.10:27124', '192.168.1.10')).toBe(true);
    expect(baseUrlAgreesWithUrlParser('https://vault.example.com:443', 'vault.example.com')).toBe(true);
    expect(baseUrlAgreesWithUrlParser('https://0x7f000001.nip.io:443', '0x7f000001.nip.io')).toBe(true);
  });
});
