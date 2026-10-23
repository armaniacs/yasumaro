/**
 * tabLifecycle.test.ts — the shared tab open/wait/close seam
 * (PBI 2026-10-24-06).
 *
 * Table: timeout policy (best-effort vs reject) x settle path (already
 * complete, listener complete, timeout, getTab error). Both fetchers keep
 * their read paths; only this lifecycle is shared.
 */
import { useTimerClock } from '../../../testDir/waitPolicy.js';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  closeHelperTab,
  openHelperTab,
  waitForTabComplete,
  type TabLifecyclePorts,
  type TabLoadTimeoutPolicy,
} from '../tabLifecycle.js';

type UpdateCb = (tabId: number, info: { status?: string }) => void;

interface TestPorts extends TabLifecyclePorts {
  listeners: Set<UpdateCb>;
}

function makePorts(): TestPorts {
  const listeners = new Set<UpdateCb>();
  return {
    createTab: vi.fn().mockResolvedValue({ id: 11 }),
    getTab: vi.fn().mockResolvedValue({ status: 'complete' }),
    removeTab: vi.fn().mockResolvedValue(undefined),
    onUpdated: {
      addListener: vi.fn((fn: UpdateCb) => {
        listeners.add(fn);
      }),
      removeListener: vi.fn((fn: UpdateCb) => {
        listeners.delete(fn);
      }),
    },
    listeners,
  };
}

describe('tabLifecycle', () => {
  describe('openHelperTab', () => {
    it('opens an inactive tab and returns its id', async () => {
      const ports = makePorts();
      await expect(openHelperTab(ports, 'https://example.com/page')).resolves.toBe(11);
      expect(ports.createTab).toHaveBeenCalledWith({ url: 'https://example.com/page', active: false });
    });

    it('throws tab_create_failed when the created tab has no id', async () => {
      const ports = makePorts();
      ports.createTab = vi.fn().mockResolvedValue({});
      await expect(openHelperTab(ports, 'https://example.com')).rejects.toThrow('tab_create_failed');
    });
  });

  describe('waitForTabComplete', () => {
    afterEach(() => vi.useRealTimers());

    it.each(['best-effort', 'reject'] as const)(
      'resolves immediately when the tab is already complete (%s)',
      async (policy: TabLoadTimeoutPolicy) => {
        const ports = makePorts();
        await expect(waitForTabComplete(ports, 11, 10_000, policy)).resolves.toBeUndefined();
        expect(ports.listeners.size).toBe(0);
      },
    );

    it.each(['best-effort', 'reject'] as const)(
      'resolves via the onUpdated listener when the tab starts loading (%s)',
      async (policy: TabLoadTimeoutPolicy) => {
        const ports = makePorts();
        ports.getTab = vi.fn().mockResolvedValue({ status: 'loading' });
        const pending = waitForTabComplete(ports, 11, 10_000, policy);
        expect(ports.listeners.size).toBe(1);
        for (const fn of ports.listeners) fn(11, { status: 'complete' });
        await expect(pending).resolves.toBeUndefined();
        expect(ports.listeners.size).toBe(0);
      },
    );

    it('ignores complete events for other tabs', async () => {
      const ports = makePorts();
      ports.getTab = vi.fn().mockResolvedValue({ status: 'loading' });
      useTimerClock();
      const pending = waitForTabComplete(ports, 11, 10_000, 'reject');
      void pending.catch(() => undefined);
      for (const fn of ports.listeners) fn(999, { status: 'complete' });
      expect(ports.listeners.size).toBe(1);
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(pending).rejects.toThrow('tab_load_timeout');
      expect(ports.listeners.size).toBe(0);
    });

    it.each([
      { policy: 'best-effort', settles: 'resolves' },
      { policy: 'reject', settles: 'rejects' },
    ] as const)('$settles on timeout ($policy)', async ({ policy, settles }) => {
      const ports = makePorts();
      ports.getTab = vi.fn().mockResolvedValue({ status: 'loading' });
      useTimerClock();
      const pending = waitForTabComplete(ports, 11, 10_000, policy);
      void pending.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(10_000);
      if (settles === 'resolves') {
        await expect(pending).resolves.toBeUndefined();
      } else {
        await expect(pending).rejects.toThrow('tab_load_timeout');
      }
      expect(ports.listeners.size).toBe(0);
    });

    it.each([
      { policy: 'best-effort', settles: 'resolves' },
      { policy: 'reject', settles: 'rejects' },
    ] as const)('$settles when getTab fails ($policy)', async ({ policy, settles }) => {
      const ports = makePorts();
      ports.getTab = vi.fn().mockRejectedValue(new Error('no such tab'));
      const pending = waitForTabComplete(ports, 11, 10_000, policy);
      if (settles === 'resolves') {
        await expect(pending).resolves.toBeUndefined();
      } else {
        await expect(pending).rejects.toThrow('tab_get_failed');
      }
      expect(ports.listeners.size).toBe(0);
    });
  });

  describe('closeHelperTab', () => {
    it('removes the tab', async () => {
      const ports = makePorts();
      await closeHelperTab(ports, 11);
      expect(ports.removeTab).toHaveBeenCalledWith(11);
    });

    it('swallows teardown errors without an onError hook', async () => {
      const ports = makePorts();
      ports.removeTab = vi.fn().mockRejectedValue(new Error('No tab with id'));
      await expect(closeHelperTab(ports, 11)).resolves.toBeUndefined();
    });

    it('forwards teardown errors to onError when provided', async () => {
      const ports = makePorts();
      ports.removeTab = vi.fn().mockRejectedValue(new Error('gone'));
      const onError = vi.fn();
      await closeHelperTab(ports, 11, onError);
      expect(onError).toHaveBeenCalledTimes(1);
    });
  });
});
