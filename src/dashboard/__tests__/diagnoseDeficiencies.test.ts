// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { diagnoseDeficiencies, type DiagnosticInput } from '../diagnoseDeficiencies.js';

/** Helper: create a DiagnosticInput with all capabilities present and initialized. */
function fullInput(overrides: Partial<DiagnosticInput> = {}): DiagnosticInput {
  return {
    opfsDirectory: true,
    syncAccessHandle: true,
    worker: true,
    initialized: true,
    fallback: false,
    fts5: true,
    vfsStrategy: 'opfs-sync-worker',
    ...overrides,
  };
}

describe('diagnoseDeficiencies', () => {
  it('returns no deficiencies when all capabilities are present and FTS5 is available', () => {
    const result = diagnoseDeficiencies(fullInput());
    expect(result).toEqual([]);
  });

  it('detects no-opfs when opfsDirectory is false AND fallback is active', () => {
    const result = diagnoseDeficiencies(fullInput({ opfsDirectory: false, fallback: true }));
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'no-opfs', severity: 'high' }),
      ])
    );
  });

  it('does not detect no-sync-access-handle when opfsDirectory is false', () => {
    const result = diagnoseDeficiencies(fullInput({ opfsDirectory: false, syncAccessHandle: false }));
    expect(result.find(d => d.id === 'no-sync-access-handle')).toBeUndefined();
  });

  it('does not detect no-opfs when opfsDirectory is false but IDB is working', () => {
    const result = diagnoseDeficiencies(fullInput({ opfsDirectory: false, fallback: false }));
    expect(result.find(d => d.id === 'no-opfs')).toBeUndefined();
  });

  it('detects no-sync-access-handle when syncAccessHandle is false but opfsDirectory is true', () => {
    const result = diagnoseDeficiencies(fullInput({ syncAccessHandle: false }));
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'no-sync-access-handle', severity: 'medium' }),
      ])
    );
  });

  it('does not detect no-sync-access-handle when opfsDirectory is false', () => {
    const result = diagnoseDeficiencies(fullInput({ opfsDirectory: false, syncAccessHandle: false }));
    expect(result.find(d => d.id === 'no-sync-access-handle')).toBeUndefined();
  });

  it('detects no-worker when worker is false but opfsDirectory is true', () => {
    const result = diagnoseDeficiencies(fullInput({ worker: false }));
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'no-worker', severity: 'medium' }),
      ])
    );
  });

  it('detects no-fts5 for IDB path when fts5 is false', () => {
    const result = diagnoseDeficiencies(fullInput({ fts5: false, vfsStrategy: 'idb' as DiagnosticInput['vfsStrategy'] }));
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'no-fts5', severity: 'low' }),
      ])
    );
  });

  it('detects opfs-no-fts5 for OPFS sync worker path when fts5 is false', () => {
    const result = diagnoseDeficiencies(fullInput({ fts5: false, vfsStrategy: 'opfs-sync-worker' }));
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'opfs-no-fts5', severity: 'low' }),
      ])
    );
  });

  it('does not detect fts5 deficiency when initialized is false', () => {
    const result = diagnoseDeficiencies(fullInput({ fts5: false, initialized: false }));
    expect(result.find(d => d.id === 'no-fts5' || d.id === 'opfs-no-fts5')).toBeUndefined();
  });

  it('detects init-failed when initialized is false and initError is present', () => {
    const result = diagnoseDeficiencies(fullInput({ initialized: false, initError: 'SQLITE_CANTOPEN' }));
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'init-failed', severity: 'high' }),
      ])
    );
  });

  it('detects not-initialized when initialized is false and no initError', () => {
    const result = diagnoseDeficiencies(fullInput({ initialized: false }));
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'not-initialized', severity: 'medium' }),
      ])
    );
  });

  it('detects fallback-mode when fallback is true', () => {
    const result = diagnoseDeficiencies(fullInput({ fallback: true }));
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'fallback-mode', severity: 'high' }),
      ])
    );
  });

  it('combines multiple deficiencies correctly', () => {
    const result = diagnoseDeficiencies(fullInput({
      opfsDirectory: false,
      fts5: false,
      fallback: true,
      vfsStrategy: 'fallback',
    }));
    const ids = result.map(d => d.id);
    expect(ids).toContain('no-opfs');
    expect(ids).toContain('no-fts5');
    expect(ids).toContain('fallback-mode');
  });

  it('returns all fields in each deficiency item', () => {
    const result = diagnoseDeficiencies(fullInput({ opfsDirectory: false, fallback: true }));
    expect(result.length).toBeGreaterThanOrEqual(1);
    for (const item of result) {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('severity');
      expect(item).toHaveProperty('summaryKey');
      expect(item).toHaveProperty('detailKey');
      expect(item).toHaveProperty('recommendedActionKey');
      expect(typeof item.summaryKey).toBe('string');
      expect(typeof item.detailKey).toBe('string');
      expect(typeof item.recommendedActionKey).toBe('string');
    }
  });
});
