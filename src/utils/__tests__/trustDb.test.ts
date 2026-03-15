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