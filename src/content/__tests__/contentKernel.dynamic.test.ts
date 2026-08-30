// @vitest-environment jsdom
/**
 * contentKernel.dynamic.test.ts — 30-13 SPA動的コンテンツ
 * MutationObserver をモックして debounce 500ms の挙動を検証
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('watchDynamicContent (30-13)', () => {
  let mockCallbacks: Array<() => void> = [];
  let OriginalMutationObserver: typeof MutationObserver | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="root"></div>';
    mockCallbacks = [];
    OriginalMutationObserver = (globalThis as unknown as { MutationObserver?: typeof MutationObserver }).MutationObserver;

    class MockMutationObserver {
      private cb: MutationCallback;
      private wrapped?: () => void;
      constructor(cb: MutationCallback) {
        this.cb = cb;
      }
      observe() {
        const fn = () => this.cb([] as unknown as MutationRecord[], this as unknown as MutationObserver);
        this.wrapped = fn;
        mockCallbacks.push(fn);
      }
      disconnect() {
        if (this.wrapped) {
          mockCallbacks = mockCallbacks.filter((f) => f !== this.wrapped);
        }
      }
      takeRecords() { return []; }
    }
    (globalThis as unknown as { MutationObserver: unknown }).MutationObserver = MockMutationObserver as unknown as typeof MutationObserver;
    (globalThis as unknown as { window: unknown }).window = globalThis.window;
    if (typeof window !== 'undefined') {
      (window as unknown as { MutationObserver: unknown }).MutationObserver = MockMutationObserver as unknown as typeof MutationObserver;
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    if (OriginalMutationObserver) {
      (globalThis as unknown as { MutationObserver: unknown }).MutationObserver = OriginalMutationObserver as unknown;
      if (typeof window !== 'undefined') {
        (window as unknown as { MutationObserver: unknown }).MutationObserver = OriginalMutationObserver as unknown;
      }
    }
    mockCallbacks = [];
  });

  function triggerMutation() {
    for (const cb of [...mockCallbacks]) cb();
  }

  it('MutationObserver で DOM 追加を検出し debounce 500ms で onChange を呼ぶ', async () => {
    const { watchDynamicContent } = await import('../contentKernel.js');
    const onChange = vi.fn();
    const target = document.getElementById('root')!;
    const disconnect = watchDynamicContent(target, onChange, 500);

    triggerMutation();

    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(onChange).toHaveBeenCalledTimes(1);

    disconnect();
  });

  it('連続した変化は debounce で1回にまとまる', async () => {
    const { watchDynamicContent } = await import('../contentKernel.js');
    const onChange = vi.fn();
    const target = document.getElementById('root')!;
    const disconnect = watchDynamicContent(target, onChange, 500);

    for (let i = 0; i < 5; i++) {
      triggerMutation();
      vi.advanceTimersByTime(100);
    }
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(onChange).toHaveBeenCalledTimes(1);
    disconnect();
  });

  it('変化がなければ onChange は呼ばれない', async () => {
    const { watchDynamicContent } = await import('../contentKernel.js');
    const onChange = vi.fn();
    const target = document.getElementById('root')!;
    const disconnect = watchDynamicContent(target, onChange, 500);
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();
    disconnect();
  });

  it('disconnect後は onChange が呼ばれない', async () => {
    const { watchDynamicContent } = await import('../contentKernel.js');
    const onChange = vi.fn();
    const target = document.getElementById('root')!;
    const disconnect = watchDynamicContent(target, onChange, 500);
    disconnect();
    triggerMutation();
    vi.advanceTimersByTime(600);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('target null のとき document.body を監視する', async () => {
    const { watchDynamicContent } = await import('../contentKernel.js');
    const onChange = vi.fn();
    const disconnect = watchDynamicContent(null, onChange, 500);
    // body 用のコールバックが登録されているはず
    expect(mockCallbacks.length).toBeGreaterThanOrEqual(1);
    triggerMutation();
    vi.advanceTimersByTime(600);
    expect(onChange).toHaveBeenCalledTimes(1);
    disconnect();
  });

  it('ContentKernel.watchDynamicContent 経由でも監視できる', async () => {
    const { ContentKernel } = await import('../contentKernel.js');
    const { InMemoryStoragePort } = await import('../../utils/storage/storagePort.js');
    const { InMemoryDomainPolicyPort } = await import('../domainPolicyPort.js');
    const storage = new InMemoryStoragePort();
    const policy = new InMemoryDomainPolicyPort();
    const kernel = new ContentKernel(storage, policy);
    const onChange = vi.fn();
    const target = document.getElementById('root')!;
    const disconnect = kernel.watchDynamicContent(onChange, target, 500);
    triggerMutation();
    vi.advanceTimersByTime(600);
    expect(onChange).toHaveBeenCalledTimes(1);
    disconnect();
  });

  it('カスタム debounceMs で動作する', async () => {
    const { watchDynamicContent } = await import('../contentKernel.js');
    const onChange = vi.fn();
    const target = document.getElementById('root')!;
    const disconnect = watchDynamicContent(target, onChange, 100);
    triggerMutation();
    vi.advanceTimersByTime(90);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20);
    expect(onChange).toHaveBeenCalledTimes(1);
    disconnect();
  });

  it('実DOM変化でもMutationObserverが発火する統合', async () => {
    // モックを一旦戻して実DOMで1件だけ確認（先頭テストの代替）
    if (OriginalMutationObserver) {
      (globalThis as unknown as { MutationObserver: unknown }).MutationObserver = OriginalMutationObserver as unknown;
      if (typeof window !== 'undefined') (window as unknown as { MutationObserver: unknown }).MutationObserver = OriginalMutationObserver as unknown;
    }
    vi.useRealTimers();
    const { watchDynamicContent } = await import('../contentKernel.js');
    const onChange = vi.fn();
    const target = document.getElementById('root')!;
    const disconnect = watchDynamicContent(target, onChange, 50);
    const el = document.createElement('div');
    target.appendChild(el);
    await new Promise((r) => setTimeout(r, 80));
    expect(onChange).toHaveBeenCalledTimes(1);
    disconnect();
    vi.useFakeTimers();
  });
});
