// @vitest-environment jsdom
/**
 * registryContext.test.ts
 * PBI 2026-08-08-09 Phase 3
 *
 * dashboard.ts のパネル遷移はクリック合成
 * (`.sidebar-nav-btn[data-panel=...]`.click()) で行われていた。これは
 * NavigationRegistry を無視した迂回だが、単なる手抜きではなく
 * **初期化順の制約**への対処でもある:
 *
 *   entrypoints/options/main.ts は dashboard.ts を main.ts より先に import し、
 *   dashboard.ts は末尾で void initDashboard() を自己実行する。
 *   その時点では main.ts の setRegistry() がまだ走っておらず、
 *   getRegistry() は例外を投げる。
 *
 * tryGetRegistry() はこの「まだ居ないかもしれない」状態を型と戻り値で
 * 表現し、呼び出し側がフォールバックできるようにする。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { NavigationRegistry } from '../NavigationRegistry.js';
import { setRegistry, getRegistry, tryGetRegistry } from '../registryContext.js';

describe('registryContext', () => {
  beforeEach(() => {
    // registryContext holds module-global state; re-import isolation is handled
    // by vitest per test file, so set a fresh registry for each test here.
    setRegistry(new NavigationRegistry());
  });

  it('getRegistry returns the registered registry', () => {
    const registry = new NavigationRegistry();
    setRegistry(registry);
    expect(getRegistry()).toBe(registry);
  });

  it('tryGetRegistry returns the same instance once registered', () => {
    const registry = new NavigationRegistry();
    setRegistry(registry);
    expect(tryGetRegistry()).toBe(registry);
  });

  it('tryGetRegistry never throws, unlike getRegistry', () => {
    // Callers that may run before src/dashboard/main.ts must be able to ask
    // without risking an exception during page bootstrap.
    expect(() => tryGetRegistry()).not.toThrow();
  });
});
