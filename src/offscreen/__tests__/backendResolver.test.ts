// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { resolveBackend } from '../backendResolver.js';

// ── resolveBackend (pure function, no mocks needed) ──────────────────────────

describe('resolveBackend', () => {
  it('returns opfs when OPFS worker is available', () => {
    expect(resolveBackend({
      opfsWorker: true, idbEngine: false,
      usingFallbackStorage: false, fallbackStorage: false,
    })).toBe('opfs');
  });

  it('returns opfs when both OPFS and IDB are available (OPFS takes priority)', () => {
    expect(resolveBackend({
      opfsWorker: true, idbEngine: true,
      usingFallbackStorage: false, fallbackStorage: false,
    })).toBe('opfs');
  });

  it('returns idb when OPFS is unavailable and IDB is available', () => {
    expect(resolveBackend({
      opfsWorker: false, idbEngine: true,
      usingFallbackStorage: false, fallbackStorage: false,
    })).toBe('idb');
  });

  it('returns fallback when OPFS and IDB are unavailable but fallback storage exists', () => {
    expect(resolveBackend({
      opfsWorker: false, idbEngine: false,
      usingFallbackStorage: true, fallbackStorage: true,
    })).toBe('fallback');
  });

  it('returns opfs when all three are available (OPFS takes priority)', () => {
    expect(resolveBackend({
      opfsWorker: true, idbEngine: true,
      usingFallbackStorage: true, fallbackStorage: true,
    })).toBe('opfs');
  });

  it('returns none when nothing is available', () => {
    expect(resolveBackend({
      opfsWorker: false, idbEngine: false,
      usingFallbackStorage: false, fallbackStorage: false,
    })).toBe('none');
  });

  it('returns none when usingFallbackStorage is true but fallbackStorage is false', () => {
    expect(resolveBackend({
      opfsWorker: false, idbEngine: false,
      usingFallbackStorage: true, fallbackStorage: false,
    })).toBe('none');
  });

  it('returns none when usingFallbackStorage is false but fallbackStorage is true', () => {
    expect(resolveBackend({
      opfsWorker: false, idbEngine: false,
      usingFallbackStorage: false, fallbackStorage: true,
    })).toBe('none');
  });
});
