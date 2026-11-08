// @vitest-environment jsdom
/**
 * pausePanel-r2.test.ts
 *
 * PBI 2026-11-08-08 (3): re-initializing the pause panel must not stack
 * duplicate press handlers — one re-entry used to send PAUSE_RECORDING /
 * RESUME_RECORDING twice per click. These tests pin the wireOnce contract:
 * two initPausePanel calls on the same DOM still send one message per click.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { waitForMock } from '../../../testDir/waitPolicy.js';
import { drainMacrotask } from '../../../testDir/waitPolicy.js';

const FIXED_NOW = 1_760_000_000_000;

function setPanelDom(): void {
  document.body.innerHTML =
    '<button id="pauseBtn" aria-label="Pause auto-save"></button>' +
    '<button id="resumeBtn" class="hidden" aria-label="Resume now"></button>' +
    '<span id="pauseStateLabel" aria-live="polite"></span>';
}

type SendFn = ((message: Record<string, unknown>) => Promise<unknown>) & { calls: unknown[] };

const PRESS_STEPS = [30, 60, 90, 120];

function createSend(initialState: number | null = null): SendFn {
  const calls: unknown[] = [];
  let pausedUntil: number | null = initialState;
  const send = (async (message: Record<string, unknown>): Promise<unknown> => {
    calls.push(message);
    if (message.type === 'GET_PAUSE_STATE') {
      return { success: true, pausedUntil };
    }
    if (message.type === 'PAUSE_RECORDING') {
      const minutes = (message.payload as { minutes?: unknown }).minutes;
      const mins = PRESS_STEPS.includes(minutes as number) ? (minutes as number) : 30;
      pausedUntil = FIXED_NOW + mins * 60_000;
      return { success: true, pausedUntil };
    }
    if (message.type === 'RESUME_RECORDING') {
      pausedUntil = null;
      return { success: true };
    }
    return { success: true };
  }) as SendFn;
  send.calls = calls;
  return send;
}

function countType(send: SendFn, type: string): number {
  return send.calls.filter((m) => (m as { type?: unknown }).type === type).length;
}

describe('pausePanel', () => {
  describe('initPausePanel re-init', () => {
    beforeEach(() => {
      (globalThis as Record<string, unknown>).chrome = {
        i18n: { getMessage: () => '' },
      };
    });

    afterEach(() => {
      document.body.innerHTML = '';
      delete (globalThis as Record<string, unknown>).chrome;
      vi.restoreAllMocks();
    });

    it('sends PAUSE_RECORDING once per click even when initialized twice on the same DOM', async () => {
      setPanelDom();
      const send = createSend();
      const { initPausePanel } = await import('../pausePanel.js');
      initPausePanel({ sendMessage: send, now: () => FIXED_NOW });
      initPausePanel({ sendMessage: send, now: () => FIXED_NOW });

      (document.getElementById('pauseBtn') as HTMLButtonElement).click();

      await waitForMock(() => expect(countType(send, 'PAUSE_RECORDING')).toBe(1));
      // One more macrotask turn: a stacked duplicate handler would have fired by now.
      await drainMacrotask();
      expect(countType(send, 'PAUSE_RECORDING')).toBe(1);
    });

    it('sends RESUME_RECORDING once per click even when initialized twice on the same DOM', async () => {
      setPanelDom();
      const send = createSend(FIXED_NOW + 30 * 60_000);
      const { initPausePanel } = await import('../pausePanel.js');
      initPausePanel({ sendMessage: send, now: () => FIXED_NOW });
      initPausePanel({ sendMessage: send, now: () => FIXED_NOW });
      await drainMacrotask();

      (document.getElementById('resumeBtn') as HTMLButtonElement).click();

      await waitForMock(() => expect(countType(send, 'RESUME_RECORDING')).toBe(1));
      await drainMacrotask();
      expect(countType(send, 'RESUME_RECORDING')).toBe(1);
    });
  });
});
