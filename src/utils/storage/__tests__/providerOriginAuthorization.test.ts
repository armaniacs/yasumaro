import { describe, it, expect } from 'vitest';
import {
  isProviderOriginAuthorized,
  PROVIDER_ALLOWLIST_ROWS,
} from '../../storage/providerAllowlist.js';
import { StorageKeys } from '../../storage/types.js';

const openaiCompatibleRow = PROVIDER_ALLOWLIST_ROWS.find((r) => r.id === 'openai-compatible');
const openaiRow = PROVIDER_ALLOWLIST_ROWS.find((r) => r.id === 'openai');
const lmStudioRow = PROVIDER_ALLOWLIST_ROWS.find((r) => r.id === 'lm-studio');

describe('isProviderOriginAuthorized — provider origin policy (VULN-002)', () => {
  it('authorizes the pinned row domain', () => {
    const decision = isProviderOriginAuthorized(
      'https://api.openai.com/v1',
      openaiRow,
      new Set(),
    );
    expect(decision).toEqual({ authorized: true, reason: 'pinned' });
  });

  it('authorizes a subdomain of the pinned row domain', () => {
    const decision = isProviderOriginAuthorized(
      'https://eu.api.openai.com/v1',
      openaiRow,
      new Set(),
    );
    expect(decision.authorized).toBe(true);
    expect(decision.reason).toBe('pinned');
  });

  it('authorizes a known provider endpoint hosted in a configurable slot', () => {
    // api.groq.com is a fixed endpoint of the groq row — recognized as a
    // legitimate AI-provider host even inside the openai-compatible slot.
    const decision = isProviderOriginAuthorized(
      'https://api.groq.com/openai/v1',
      openaiCompatibleRow,
      new Set(),
    );
    expect(decision.authorized).toBe(true);
    expect(decision.reason).toBe('provider-domain');
  });

  it('authorizes loopback origins in local-provider slots (LM Studio / Ollama exception)', () => {
    expect(
      isProviderOriginAuthorized('http://127.0.0.1:1234/v1', lmStudioRow, new Set()).reason,
    ).toBe('local');
    const ollamaRow = PROVIDER_ALLOWLIST_ROWS.find((r) => r.id === 'ollama');
    expect(
      isProviderOriginAuthorized('http://localhost:11434/v1', ollamaRow, new Set()).reason,
    ).toBe('local');
  });

  it('denies loopback http in a non-local slot unless the origin was confirmed', () => {
    // Plaintext credentials to localhost must not self-authorize outside the
    // local rows — the dashboard confirmation dialog owns this origin first.
    expect(
      isProviderOriginAuthorized('http://localhost:11434/v1', openaiCompatibleRow, new Set()),
    ).toEqual({ authorized: false, reason: 'denied' });
    expect(
      isProviderOriginAuthorized('https://localhost:9999/v1', openaiCompatibleRow, new Set()).authorized,
    ).toBe(false);
    expect(
      isProviderOriginAuthorized(
        'http://localhost:11434/v1',
        openaiCompatibleRow,
        new Set(['http://localhost:11434']),
      ),
    ).toEqual({ authorized: true, reason: 'confirmed' });
  });

  it('authorizes an exact user-confirmed origin', () => {
    const decision = isProviderOriginAuthorized(
      'https://custom-endpoint.example/v1',
      openaiCompatibleRow,
      new Set(['https://custom-endpoint.example']),
    );
    expect(decision).toEqual({ authorized: true, reason: 'confirmed' });
  });

  it('rejects an attacker origin that was never confirmed (exploit regression)', () => {
    const decision = isProviderOriginAuthorized(
      'https://attacker.example/v1',
      openaiCompatibleRow,
      new Set(),
    );
    expect(decision).toEqual({ authorized: false, reason: 'denied' });
  });

  it('rejects a non-confirmed origin even when another slot was confirmed', () => {
    const decision = isProviderOriginAuthorized(
      'https://attacker.example/v1',
      openaiCompatibleRow,
      new Set(['https://other-confirmed.example']),
    );
    expect(decision.authorized).toBe(false);
  });

  it('rejects private-range and metadata hosts (deny-only SSRF layer stays active)', () => {
    expect(
      isProviderOriginAuthorized('https://10.0.0.5/v1', openaiCompatibleRow, new Set()).authorized,
    ).toBe(false);
    expect(
      isProviderOriginAuthorized('https://169.254.169.254/latest', openaiCompatibleRow, new Set()).authorized,
    ).toBe(false);
    expect(
      isProviderOriginAuthorized('https://metadata.google.internal/compute', openaiCompatibleRow, new Set()).authorized,
    ).toBe(false);
  });

  it('denies a decimal-encoded loopback in a non-local slot (no local exception there)', () => {
    // WHATWG URL resolves 2130706433 to 127.0.0.1 before hostname matching,
    // so the origin is the loopback itself — but the local-provider exception
    // no longer applies outside local rows, so it stays denied without
    // an explicit confirmation.
    const decision = isProviderOriginAuthorized(
      'https://2130706433/v1',
      openaiCompatibleRow,
      new Set(),
    );
    expect(decision).toEqual({ authorized: false, reason: 'denied' });
  });

  it('rejects plaintext http to a non-loopback host', () => {
    expect(
      isProviderOriginAuthorized('http://attacker.example/v1', openaiCompatibleRow, new Set()).authorized,
    ).toBe(false);
  });

  it('rejects invalid URLs', () => {
    expect(
      isProviderOriginAuthorized('not-a-url', openaiCompatibleRow, new Set()).authorized,
    ).toBe(false);
  });
});

describe('built-in-ai on-device contract', () => {
  it('declares no baseUrlKey (the structural pin BuiltInAiProvider enforces)', () => {
    const row = PROVIDER_ALLOWLIST_ROWS.find((r) => r.id === 'built-in-ai');
    expect(row?.baseUrlKey).toBeUndefined();
  });
});

describe('CONFIRMED_PROVIDER_ORIGINS key contract', () => {
  it('is present on StorageKeys and typed as a per-key origin map', () => {
    expect(StorageKeys.CONFIRMED_PROVIDER_ORIGINS).toBe('confirmed_provider_origins');
  });
});
