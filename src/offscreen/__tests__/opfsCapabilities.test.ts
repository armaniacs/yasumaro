// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  detectOpfsCapabilities,
  selectVfsStrategy,
  detectLiveVfsStrategy,
  type OpfsProbeGlobals,
} from '../opfsCapabilities.js';

const fullEnv = (): OpfsProbeGlobals => ({
  storage: { getDirectory: () => Promise.resolve({}) },
  fileSystemFileHandle: { prototype: { createSyncAccessHandle: () => ({}) } },
  worker: function Worker() {},
});

describe('detectOpfsCapabilities', () => {
  it('reports all capabilities present when the full OPFS API is available', () => {
    const caps = detectOpfsCapabilities(fullEnv());
    expect(caps).toEqual({ opfsDirectory: true, syncAccessHandle: true, worker: true });
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

  it('reports everything false in a bare environment (jsdom default)', () => {
    const caps = detectOpfsCapabilities({});
    expect(caps).toEqual({ opfsDirectory: false, syncAccessHandle: false, worker: false });
  });
});

describe('selectVfsStrategy', () => {
  it('selects the Worker + SyncAccessHandle strategy (案A) when fully capable', () => {
    expect(selectVfsStrategy({ opfsDirectory: true, syncAccessHandle: true, worker: true }))
      .toBe('opfs-sync-worker');
  });

  it('falls back to async main-thread OPFS (案B) when sync/worker is unavailable', () => {
    expect(selectVfsStrategy({ opfsDirectory: true, syncAccessHandle: false, worker: true }))
      .toBe('opfs-async-main');
    expect(selectVfsStrategy({ opfsDirectory: true, syncAccessHandle: true, worker: false }))
      .toBe('opfs-async-main');
  });

  it('falls back to chrome.storage.local when OPFS itself is unavailable', () => {
    expect(selectVfsStrategy({ opfsDirectory: false, syncAccessHandle: false, worker: false }))
      .toBe('fallback');
  });
});

describe('detectLiveVfsStrategy', () => {
  it('probes the real environment and returns matching caps and strategy', () => {
    // jsdom lacks navigator.storage.getDirectory, so OPFS is unavailable here.
    const result = detectLiveVfsStrategy();
    expect(result.caps.opfsDirectory).toBe(false);
    expect(result.strategy).toBe('fallback');
  });
});
