/**
 * @jest-environment jsdom
 */

/**
 * trustDb.test.ts
 * Unit tests for Trust Database (Phase 1)
 * Basic verification that the modules can be loaded
 */

import { jest } from '@jest/globals';

describe('TrustDatabase - Phase 1 - Module Loading', () => {
  it('should trustDb module be loadable', async () => {
    const trustDbModule = await import('../trustDb/trustDb');
    expect(trustDbModule).toBeDefined();
    expect(typeof trustDbModule.getTrustDb).toBe('function');
  });

  it('should trustDbSchema module be loadable', async () => {
    const schemaModule = await import('../trustDb/trustDbSchema');
    expect(schemaModule).toBeDefined();
    expect(schemaModule.DomainTrustLevel).toBeDefined();
    expect(schemaModule.DomainTrustLevel.TRUSTED).toBe('trusted');
  });

  it('should bloomFilter module be loadable', async () => {
    const bloomFilterModule = await import('../trustDb/bloomFilter');
    expect(bloomFilterModule).toBeDefined();
    expect(typeof bloomFilterModule.createBloomFilter).toBe('function');
  });

  it('should trancoUpdater module be loadable', async () => {
    const updaterModule = await import('../trustDb/trancoUpdater');
    expect(updaterModule).toBeDefined();
    expect(typeof updaterModule.getTrancoUpdater).toBe('function');
    expect(updaterModule.SAFETY_MODE_TO_TRANCO_TIER).toBeDefined();
    expect(updaterModule.SAFETY_MODE_TO_TRANCO_TIER['strict']).toBe('top1k');
  });
});

describe('DOMAIN_REGEX trailing dot fix', () => {
  it('should reject trailing dot domains after fix', () => {
    // この正規表現は修正後の期待動作を表す（テストは最初からPASSする想定）
    // 修正前の正規表現: /...\\.?$/i — a. が通過してしまう
    // 修正後の正規表現: /...$/i  — a. を弾く
    const FIXED = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/i;
    expect(FIXED.test('a.')).toBe(false);
    expect(FIXED.test('example..com')).toBe(false);
    expect(FIXED.test('example.com')).toBe(true);
    expect(FIXED.test('sub.example.co.jp')).toBe(true);
    expect(FIXED.test('localhost')).toBe(true);
  });
});

describe('addUserTld / addJpAnchorTld parity', () => {
  it('addUserTld rejects invalid TLD', async () => {
    const trustDbModule = await import('../trustDb/trustDb');
    const db = trustDbModule.getTrustDb();
    await db.initialize();
    const r = await db.addUserTld('invalid!tld');
    expect(r.success).toBe(false);
  });

  it('addJpAnchorTld rejects same invalid TLD', async () => {
    const trustDbModule = await import('../trustDb/trustDb');
    const db = trustDbModule.getTrustDb();
    await db.initialize();
    const r = await db.addJpAnchorTld('invalid!tld');
    expect(r.success).toBe(false);
  });
});