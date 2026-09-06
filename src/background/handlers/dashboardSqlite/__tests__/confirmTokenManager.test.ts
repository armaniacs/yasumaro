import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createConfirmToken, verifyConfirmToken, computeScopeHash, CONFIRM_TOKEN_TTL_MS, __resetConfirmTokensForTesting } from '../../../confirmTokenManager.js';

describe('confirmTokenManager per-action single-use TTL', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await __resetConfirmTokensForTesting();
  });
  afterEach(async () => {
    vi.useRealTimers();
    await __resetConfirmTokensForTesting();
  });

  it('creates token bound to action/id and verifies successfully', async () => {
    const token = await createConfirmToken('delete', 42);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(10);
    const ok = await verifyConfirmToken(token, 'delete', 42);
    expect(ok).toBe(true);
  });

  it('single-use: second verify fails', async () => {
    const token = await createConfirmToken('delete', 1);
    expect(await verifyConfirmToken(token, 'delete', 1)).toBe(true);
    expect(await verifyConfirmToken(token, 'delete', 1)).toBe(false);
  });

  it('TTL: token expires after 60s', async () => {
    const token = await createConfirmToken('clear_all');
    // within TTL should succeed
    vi.advanceTimersByTime(59_000);
    // Need real time for Date.now; fake timers advance Date.now as well
    // but verify uses Date.now(), so after 59s still valid with fresh verify before prune
    // Actually we need to test expiry: advance beyond TTL
    vi.advanceTimersByTime(2_000); // total 61s
    expect(await verifyConfirmToken(token, 'clear_all')).toBe(false);
  });

  it('TTL: token valid just before expiry', async () => {
    const token = await createConfirmToken('update', 5);
    vi.advanceTimersByTime(CONFIRM_TOKEN_TTL_MS - 1000);
    expect(await verifyConfirmToken(token, 'update', 5)).toBe(true);
  });

  it('action/id mismatch rejects', async () => {
    const token = await createConfirmToken('delete', 1);
    expect(await verifyConfirmToken(token, 'delete', 2)).toBe(false);
    expect(await verifyConfirmToken(token, 'update', 1)).toBe(false);
    expect(await verifyConfirmToken(token, 'delete')).toBe(false);
    // original still consumable with correct binding
    expect(await verifyConfirmToken(token, 'delete', 1)).toBe(true);
  });

  it('different actions get different tokens', async () => {
    const t1 = await createConfirmToken('delete', 1);
    const t2 = await createConfirmToken('delete', 1);
    expect(t1).not.toBe(t2);
    expect(await verifyConfirmToken(t1, 'delete', 1)).toBe(true);
    expect(await verifyConfirmToken(t2, 'delete', 1)).toBe(true);
  });

  it('stored only in chrome.storage.session', async () => {
    const token = await createConfirmToken('migrate');
    const sessionData = await chrome.storage.session.get('dashboardSqliteConfirmTokens') as Record<string, unknown>;
    expect(sessionData['dashboardSqliteConfirmTokens']).toBeDefined();
    const localData = await chrome.storage.local.get('dashboardSqliteConfirmTokens') as Record<string, unknown>;
    expect(localData['dashboardSqliteConfirmTokens']).toBeUndefined();
    expect(await verifyConfirmToken(token, 'migrate')).toBe(true);
  });

  it('parallel createConfirmToken calls do not lose entries to last-write-wins (VULN-039)', async () => {
    vi.useRealTimers();
    const tokens = await Promise.all([
      createConfirmToken('delete', 1),
      createConfirmToken('delete', 2),
      createConfirmToken('delete', 3),
      createConfirmToken('delete', 4),
      createConfirmToken('delete', 5),
    ]);
    // Without serialisation, concurrent load->save would drop all but one.
    for (let i = 0; i < tokens.length; i++) {
      expect(await verifyConfirmToken(tokens[i], 'delete', i + 1)).toBe(true);
    }
  });
});

describe('confirmTokenManager scopeHash binding (PBI 2026-09-06-01)', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await __resetConfirmTokensForTesting();
  });
  afterEach(async () => {
    vi.useRealTimers();
    await __resetConfirmTokensForTesting();
  });

  it('verifies with the matching scopeHash', async () => {
    const token = await createConfirmToken('archive_delete_by_staging', undefined, 'hash-a');
    expect(
      await verifyConfirmToken(token, 'archive_delete_by_staging', undefined, 'hash-a'),
    ).toBe(true);
  });

  it('rejects scopeHash substitution (different cutoff/staging)', async () => {
    const token = await createConfirmToken('archive_create', undefined, 'hash-cutoff');
    expect(await verifyConfirmToken(token, 'archive_create', undefined, 'hash-other')).toBe(false);
  });

  it('fails closed when the scopeHash is omitted on verify', async () => {
    const token = await createConfirmToken('archive_create', undefined, 'hash-cutoff');
    expect(await verifyConfirmToken(token, 'archive_create', undefined)).toBe(false);
  });

  it('leaves existing id-bound flows unchanged (no scopeHash on either side)', async () => {
    const token = await createConfirmToken('delete', 42);
    expect(await verifyConfirmToken(token, 'delete', 42)).toBe(true);
    expect(await verifyConfirmToken(token, 'delete', 42, 'some-hash')).toBe(false);
  });

  it('computeScopeHash is deterministic, position-sensitive, and arity-sensitive', async () => {
    const h1 = await computeScopeHash([1774969199999, 0]);
    const h2 = await computeScopeHash([1774969199999, 0]);
    expect(h1).toBe(h2);
    expect(await computeScopeHash([1774969199999, 1])).not.toBe(h1);
    // arity change (omitting includeDeleted) must change the scope
    expect(await computeScopeHash([1774969199999])).not.toBe(h1);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
});
