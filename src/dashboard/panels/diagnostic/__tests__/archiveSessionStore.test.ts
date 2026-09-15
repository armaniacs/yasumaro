// @vitest-environment jsdom
/**
 * archiveSessionStore.test.ts (PBI 2026-09-15-09)
 *
 * Staging セッションライフサイクルの状態機械テスト。遷移表:
 *   idle → staged/reopen → open → dirty → (save) open → clear → idle
 * 不正遷移は警告ログ付き no-op（過去の staging 順序退行 6.8.11 の回帰 pin 含む）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createArchiveSessionStore, type ArchiveLifecycleState } from '../archiveSessionStore.js';

describe('ArchiveSessionStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts idle with no session', () => {
    const store = createArchiveSessionStore();
    expect(store.getState()).toBe<ArchiveLifecycleState>('idle');
    expect(store.getSessionName()).toBeNull();
    expect(store.isDirty()).toBe(false);
  });

  it('stages a session (idle → staged)', () => {
    const store = createArchiveSessionStore();
    store.stageSession('staging-a');
    expect(store.getState()).toBe('staged');
    expect(store.getSessionName()).toBe('staging-a');
    expect(store.isDirty()).toBe(false);
  });

  it('opens a staged session (staged → open)', () => {
    const store = createArchiveSessionStore();
    store.stageSession('staging-a');
    store.markOpen();
    expect(store.getState()).toBe('open');
    expect(store.getSessionName()).toBe('staging-a');
  });

  it('marks an open session dirty on record update (open → dirty)', () => {
    const store = createArchiveSessionStore();
    store.stageSession('staging-a');
    store.markOpen();
    store.markDirty();
    expect(store.getState()).toBe('dirty');
    expect(store.isDirty()).toBe(true);
  });

  it('clears dirty after save (dirty → open)', () => {
    const store = createArchiveSessionStore();
    store.stageSession('staging-a');
    store.markOpen();
    store.markDirty();
    store.markSaved();
    expect(store.getState()).toBe('open');
    expect(store.isDirty()).toBe(false);
  });

  it('clears back to idle on close (→ idle)', () => {
    const store = createArchiveSessionStore();
    store.stageSession('staging-a');
    store.markOpen();
    store.markDirty();
    store.clear();
    expect(store.getState()).toBe<ArchiveLifecycleState>('idle');
    expect(store.getSessionName()).toBeNull();
    expect(store.isDirty()).toBe(false);
  });

  it('reopens an already-open session from the offscreen status (reconnect)', () => {
    const store = createArchiveSessionStore();
    store.reopen('staging-reconnect', false);
    expect(store.getState()).toBe('open');
    expect(store.getSessionName()).toBe('staging-reconnect');
    expect(store.isDirty()).toBe(false);

    store.reopen('staging-reconnect', true);
    expect(store.getState()).toBe('dirty');
    expect(store.isDirty()).toBe(true);
  });

  describe('illegal transitions — logged no-ops', () => {
    it('ignores markDirty from idle', () => {
      const store = createArchiveSessionStore();
      store.markDirty();
      expect(store.getState()).toBe<ArchiveLifecycleState>('idle');
      expect(store.isDirty()).toBe(false);
    });

    it('ignores markOpen from idle (no staged session to open)', () => {
      const store = createArchiveSessionStore();
      store.markOpen();
      expect(store.getState()).toBe<ArchiveLifecycleState>('idle');
      expect(store.getSessionName()).toBeNull();
    });

    it('ignores markSaved when not dirty', () => {
      const store = createArchiveSessionStore();
      store.stageSession('staging-a');
      store.markOpen();
      store.markSaved();
      expect(store.getState()).toBe('open');
    });
  });

  describe('6.8.11 staging regression pin', () => {
    it('keeps the session name when the viewer renders after open (list not empty)', () => {
      // 過去の退行: archiveOpen 後に sessionStaging が renderSessionList の
      // 前に設定されておらず、一覧が空・save/close が死んでいた。
      const store = createArchiveSessionStore();
      store.stageSession('restored-staging');
      store.markOpen();

      // renderSessionList のガード相当: staging 名が取得できる
      expect(store.getSessionName()).toBe('restored-staging');
      expect(store.getState()).toBe('open');
      expect(store.isDirty()).toBe(false);
    });
  });
});
