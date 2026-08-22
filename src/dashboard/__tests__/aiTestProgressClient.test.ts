import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { subscribeAiTestProgress } from '../aiTestProgressClient.js';
import { AI_TEST_PROGRESS_MESSAGE_TYPE } from '../../background/aiTestProgressNotifier.js';

type Listener = (message: unknown, sender: chrome.runtime.MessageSender) => void;

function installMockRuntime(): { listeners: Set<Listener>; extensionId: string } {
  const listeners = new Set<Listener>();
  const extensionId = 'test-extension-id';
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      id: extensionId,
      onMessage: {
        addListener: (fn: Listener) => listeners.add(fn),
        removeListener: (fn: Listener) => listeners.delete(fn),
      },
    },
  };
  return { listeners, extensionId };
}

function broadcast(listeners: Set<Listener>, message: unknown, sender: chrome.runtime.MessageSender): void {
  for (const listener of Array.from(listeners)) listener(message, sender);
}

describe('aiTestProgressClient', () => {
  let listeners: Set<Listener>;
  let extensionId: string;

  beforeEach(() => {
    vi.useFakeTimers();
    ({ listeners, extensionId } = installMockRuntime());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('delivers progress for the matching runId and stops after unsubscribe', () => {
    const onProgress = vi.fn();
    const unsubscribe = subscribeAiTestProgress('run-1', onProgress);

    broadcast(listeners, {
      type: AI_TEST_PROGRESS_MESSAGE_TYPE,
      progress: { runId: 'run-1', provider: 'openai', index: 0, total: 2 },
    }, { id: extensionId });

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith({ runId: 'run-1', provider: 'openai', index: 0, total: 2 });

    unsubscribe();

    broadcast(listeners, {
      type: AI_TEST_PROGRESS_MESSAGE_TYPE,
      progress: { runId: 'run-1', provider: 'openai', index: 1, total: 2 },
    }, { id: extensionId });

    expect(onProgress).toHaveBeenCalledTimes(1);
  });

  it('discards progress from a different runId', () => {
    const onProgress = vi.fn();
    subscribeAiTestProgress('run-1', onProgress);

    broadcast(listeners, {
      type: AI_TEST_PROGRESS_MESSAGE_TYPE,
      progress: { runId: 'run-2', provider: 'openai', index: 0, total: 1 },
    }, { id: extensionId });

    expect(onProgress).not.toHaveBeenCalled();
  });

  it('discards a message from a different extension (forged sender)', () => {
    const onProgress = vi.fn();
    subscribeAiTestProgress('run-1', onProgress);

    broadcast(listeners, {
      type: AI_TEST_PROGRESS_MESSAGE_TYPE,
      progress: { runId: 'run-1', provider: 'openai', index: 0, total: 1 },
    }, { id: 'some-other-extension' });

    expect(onProgress).not.toHaveBeenCalled();
  });

  it('rejects a malformed progress shape (missing/invalid fields)', () => {
    const onProgress = vi.fn();
    subscribeAiTestProgress('run-1', onProgress);

    const malformed: Array<Record<string, unknown>> = [
      { runId: 'run-1', provider: 'openai', index: -1, total: 2 },
      { runId: 'run-1', provider: 123, index: 0, total: 2 },
      { runId: 'run-1', provider: 'openai', index: 0 },
      { runId: 'run-1', provider: 'openai', index: 0, total: 2, model: 42 },
    ];
    for (const progress of malformed) {
      broadcast(listeners, { type: AI_TEST_PROGRESS_MESSAGE_TYPE, progress }, { id: extensionId });
    }

    expect(onProgress).not.toHaveBeenCalled();
  });

  it('ignores messages with a different message type', () => {
    const onProgress = vi.fn();
    subscribeAiTestProgress('run-1', onProgress);

    broadcast(listeners, {
      type: 'SOME_OTHER_TYPE',
      progress: { runId: 'run-1', provider: 'openai', index: 0, total: 1 },
    }, { id: extensionId });

    expect(onProgress).not.toHaveBeenCalled();
  });

  it('notifies a timeout completion once the timeout elapses without further progress', () => {
    const onProgress = vi.fn();
    const onTimeout = vi.fn();
    subscribeAiTestProgress('run-1', onProgress, { timeoutMs: 5000, onTimeout });

    vi.advanceTimersByTime(5000);

    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('does not fire timeout after unsubscribe', () => {
    const onProgress = vi.fn();
    const onTimeout = vi.fn();
    const unsubscribe = subscribeAiTestProgress('run-1', onProgress, { timeoutMs: 5000, onTimeout });

    unsubscribe();
    vi.advanceTimersByTime(5000);

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('removes the underlying chrome.runtime listener on unsubscribe', () => {
    const onProgress = vi.fn();
    expect(listeners.size).toBe(0);
    const unsubscribe = subscribeAiTestProgress('run-1', onProgress);
    expect(listeners.size).toBe(1);

    unsubscribe();
    expect(listeners.size).toBe(0);
  });
});
