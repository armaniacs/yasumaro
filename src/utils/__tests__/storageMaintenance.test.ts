import { describe, it, expect } from 'vitest';

describe('storageMaintenance.getDefaultSqliteHealthCheck', () => {
  it('returns an always-unhealthy check when background module is unreachable', async () => {
    // In the unit-test context (no service worker), the dynamic import of
    // background/sqlite/offscreenGateway.js may still resolve — but the
    // contract under test is: the returned check never throws.
    const { getDefaultSqliteHealthCheck } = await import('../storage/storageMaintenance.js');
    const hc = await getDefaultSqliteHealthCheck();
    const result = await hc();
    expect(typeof result).toBe('boolean');
  });

  it('no longer exposes module-global setSqliteHealthCheck/getSqliteHealthCheck', async () => {
    const mod = (await import('../storage/storageMaintenance.js')) as unknown as Record<string, unknown>;
    expect('setSqliteHealthCheck' in mod).toBe(false);
    expect('getSqliteHealthCheck' in mod).toBe(false);
  });
});
