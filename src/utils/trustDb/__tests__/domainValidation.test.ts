/**
 * domainValidation.test.ts
 * Contract tests for the add-time TLD validation (isValidTld) and the
 * ManagedCollections userTlds add path.
 *
 * PBI 2026-10-21-07: the add-time TLD validation accepts multi-label TLDs in
 * the same '.go.jp' format as the JP-Anchor presets, so a value that is valid
 * at verification time can also be added from the UI. The verification-time
 * path (DomainVerifier.checkJpAnchor) keeps its own multi-label validation and
 * stays pinned by domainVerifier.test.ts.
 */
import { describe, test, expect, vi } from 'vitest';
import { isValidTld } from '../domainValidation.js';
import { ManagedCollections } from '../ManagedCollections.js';
import { DomainVerifier } from '../domainVerifier.js';
import { JP_ANCHOR_TLDS } from '../presets.js';
import { bloomFilterFromDomains } from '../bloomFilter.js';
import { DomainTrustLevel, type TrustDatabase } from '../trustDbSchema.js';

function makeDatabase(userTlds: string[] = []): TrustDatabase {
  return {
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    tranco: { tier: 'top10k', domains: [], count: 0, sizeBytes: 0 },
    jpAnchor: { tlds: [...JP_ANCHOR_TLDS], userTlds: [...userTlds] },
    sensitive: {
      presets: { finance: [], gaming: [], sns: [] },
      userBlacklist: [],
      whitelist: []
    },
    bloomFilter: {
      data: '',
      hashCount: 1,
      bitCount: 1,
      expectedDomainCount: 0,
      hash: ''
    }
  };
}

describe('isValidTld (add-time contract)', () => {
  test('accepts multi-label TLDs in the preset format', () => {
    expect(isValidTld('.go.jp')).toBe(true);
    expect(isValidTld('.ac.jp')).toBe(true);
    expect(isValidTld('.lg.jp')).toBe(true);
    expect(isValidTld('.ed.jp')).toBe(true);
  });

  test('accepts multi-label TLDs without a leading dot', () => {
    expect(isValidTld('go.jp')).toBe(true);
    expect(isValidTld('ne.jp')).toBe(true);
  });

  test('still accepts single-label TLDs', () => {
    expect(isValidTld('.com')).toBe(true);
    expect(isValidTld('com')).toBe(true);
    expect(isValidTld('.ai')).toBe(true);
  });

  test('rejects an empty TLD', () => {
    expect(isValidTld('')).toBe(false);
    expect(isValidTld('.')).toBe(false);
  });

  test('rejects a too-short TLD', () => {
    expect(isValidTld('.a')).toBe(false);
  });

  test('rejects a TLD with double dots', () => {
    expect(isValidTld('..go.jp')).toBe(false);
    expect(isValidTld('go..jp')).toBe(false);
  });

  test('rejects a TLD with a trailing dot', () => {
    expect(isValidTld('.go.jp.')).toBe(false);
  });

  test('rejects wildcard TLDs', () => {
    expect(isValidTld('*.jp')).toBe(false);
    expect(isValidTld('.*')).toBe(false);
  });

  test('rejects TLDs with invalid label characters', () => {
    expect(isValidTld('.com-')).toBe(false);
    expect(isValidTld('-com')).toBe(false);
    expect(isValidTld('.com test')).toBe(false);
    expect(isValidTld('com<script>')).toBe(false);
  });

  test('rejects an overly long label (>63 chars)', () => {
    expect(isValidTld('.' + 'a'.repeat(64))).toBe(false);
  });

  test('rejects an overly long TLD (>253 chars)', () => {
    expect(isValidTld('a'.repeat(251) + '.jp')).toBe(false);
  });
});

describe('ManagedCollections.addUserTld (add-path contract)', () => {
  test('accepts a multi-label TLD in the preset format and stores it with a leading dot', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const db = makeDatabase();
    const collections = new ManagedCollections(db, save);

    const result = await collections.addUserTld('.ed.jp');

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(db.jpAnchor.userTlds).toContain('.ed.jp');
    expect(collections.getJpAnchorTlds()).toContain('.ed.jp');
    expect(save).toHaveBeenCalledTimes(1);
  });

  test('normalizes a dotless multi-label TLD to the preset format', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const db = makeDatabase();
    const collections = new ManagedCollections(db, save);

    const result = await collections.addUserTld('ne.jp');

    expect(result.success).toBe(true);
    expect(db.jpAnchor.userTlds).toContain('.ne.jp');
  });

  test('rejects an exact preset TLD as a duplicate', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const collections = new ManagedCollections(makeDatabase(), save);

    const result = await collections.addUserTld('.go.jp');

    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
    expect(save).not.toHaveBeenCalled();
  });

  test('rejects an invalid TLD with the multi-label error contract', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const collections = new ManagedCollections(makeDatabase(), save);

    const result = await collections.addUserTld('*.jp');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid TLD format');
    expect(result.error).toContain('dot-separated labels');
    expect(save).not.toHaveBeenCalled();
  });

  test('rejects a duplicate user-added TLD', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const collections = new ManagedCollections(makeDatabase(), save);
    await collections.addUserTld('.ed.jp');

    const result = await collections.addUserTld('.ed.jp');

    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe('add-time and verification-time symmetry (PBI 2026-10-21-07)', () => {
  test('a TLD added through the add path is trusted by checkJpAnchor', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const db = makeDatabase();
    const collections = new ManagedCollections(db, save);

    const addResult = await collections.addUserTld('.ed.jp');
    expect(addResult.success).toBe(true);

    const verifier = new DomainVerifier();
    const result = verifier.checkJpAnchor('example.ed.jp', {
      database: db,
      bloomFilter: bloomFilterFromDomains([]),
      trancoSet: new Set(),
      trancoRankMap: new Map(),
    });

    expect(result.level).toBe(DomainTrustLevel.TRUSTED);
    expect(result.source).toBe('jp-anchor');
  });
});
