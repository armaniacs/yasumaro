// @vitest-environment jsdom
/**
 * vfsCapabilities.test.ts
 * The pure core moved out of src/offscreen/opfsCapabilities.ts. These cases pin
 * the values the move must not change, and pin that the ambient-global read is
 * driven purely by the scope it is handed.
 */
import { describe, it, expect } from 'vitest';
import {
  detectOpfsCapabilities,
  probeOpfsGlobals,
  selectVfsStrategy,
  type OpfsProbeGlobals,
} from '../vfsCapabilities.js';

const fullEnv = (): OpfsProbeGlobals => ({
  storage: { getDirectory: () => Promise.resolve({}) },
  fileSystemFileHandle: { prototype: { createSyncAccessHandle: () => ({}) } },
  worker: function Worker() {},
});

describe('detectOpfsCapabilities', () => {
  it('reports all capabilities present when the full OPFS API is available', () => {
    expect(detectOpfsCapabilities(fullEnv()))
      .toEqual({ opfsDirectory: true, syncAccessHandle: true, worker: true });
  });

  it('reports opfsDirectory false when navigator.storage.getDirectory is missing', () => {
    const env = fullEnv();
    env.storage = {};
    expect(detectOpfsCapabilities(env).opfsDirectory).toBe(false);
  });

  it('reports syncAccessHandle false when createSyncAccessHandle is missing', () => {
    const env = fullEnv();
    env.fileSystemFileHandle = { prototype: {} };
    expect(detectOpfsCapabilities(env).syncAccessHandle).toBe(false);
  });

  it('reports worker false when the Worker constructor is missing', () => {
    const env = fullEnv();
    env.worker = undefined;
    expect(detectOpfsCapabilities(env).worker).toBe(false);
  });

  it('reports everything false in a bare environment', () => {
    expect(detectOpfsCapabilities({}))
      .toEqual({ opfsDirectory: false, syncAccessHandle: false, worker: false });
  });
});

describe('selectVfsStrategy', () => {
  it('selects the Worker + SyncAccessHandle strategy when fully capable', () => {
    expect(selectVfsStrategy({ opfsDirectory: true, syncAccessHandle: true, worker: true }))
      .toBe('opfs-sync-worker');
  });

  it('selects the IDB strategy when sync handle or worker is unavailable', () => {
    expect(selectVfsStrategy({ opfsDirectory: true, syncAccessHandle: false, worker: true }))
      .toBe('idb');
    expect(selectVfsStrategy({ opfsDirectory: true, syncAccessHandle: true, worker: false }))
      .toBe('idb');
  });

  it('falls back to chrome.storage.local when OPFS itself is unavailable', () => {
    expect(selectVfsStrategy({ opfsDirectory: false, syncAccessHandle: false, worker: false }))
      .toBe('fallback');
  });
});

describe('probeOpfsGlobals', () => {
  it('reads the probe inputs out of the given scope only', () => {
    const scope = {
      navigator: { storage: { getDirectory: () => Promise.resolve({}) } },
      FileSystemFileHandle: { prototype: { createSyncAccessHandle: () => ({}) } },
      Worker: function Worker() {},
    };

    expect(detectOpfsCapabilities(probeOpfsGlobals(scope)))
      .toEqual({ opfsDirectory: true, syncAccessHandle: true, worker: true });
  });

  it('reports nothing for a scope without the OPFS globals', () => {
    expect(detectOpfsCapabilities(probeOpfsGlobals({}))).toEqual({
      opfsDirectory: false,
      syncAccessHandle: false,
      worker: false,
    });
  });

  it('does not read the ambient globalThis when a scope is supplied', () => {
    // jsdom supplies a real Worker constructor, so a scope that omits it must
    // still probe as worker-less.
    expect(detectOpfsCapabilities(probeOpfsGlobals({ navigator: undefined })).worker).toBe(false);
  });
});
