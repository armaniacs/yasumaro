/**
 * offlineNetworkQueue-id.test.ts
 * Parity pins for OfflineJob id generation (PBI 2026-10-03-24): the factory
 * prefers crypto.randomUUID and falls back to 32-char hex from
 * crypto.getRandomValues — the same contract the shared generateId() carries
 * for every ID site. No Math.random-based fallback.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { OfflineJobFactory } from '../offlineNetworkQueue.js';

const HEX32_RE = /^[0-9a-f]{32}$/;

describe('OfflineJobFactory id parity (PBI 2026-10-03-24)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the exact crypto.randomUUID value for the job id', () => {
    const fixed = '11111111-2222-4333-8444-555555555555';
    vi.stubGlobal('crypto', { randomUUID: () => fixed });
    expect(OfflineJobFactory.create({ type: 'ai_summary', payload: {} }).id).toBe(fixed);
  });

  it('falls back to 32-char hex from getRandomValues when randomUUID is missing', () => {
    const realCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) });
    expect(OfflineJobFactory.create({ type: 'ai_summary', payload: {} }).id).toMatch(HEX32_RE);
  });

  it('never uses Math.random for the id', () => {
    const mathRandomSpy = vi.spyOn(Math, 'random');
    OfflineJobFactory.create({ type: 'ai_summary', payload: {} });
    expect(mathRandomSpy).not.toHaveBeenCalled();
    mathRandomSpy.mockRestore();
  });

  it('issues unique ids across calls', () => {
    const a = OfflineJobFactory.create({ type: 'ai_summary', payload: {} }).id;
    const b = OfflineJobFactory.create({ type: 'ai_summary', payload: {} }).id;
    expect(a).not.toBe(b);
  });
});
