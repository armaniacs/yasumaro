// @vitest-environment jsdom
/**
 * pausePanel.test.ts
 * PBI 2026-10-17-01 Task 6: popup pause controls with presets and resume.
 *
 * DI-first: the panel takes a `sendMessage` seam, so no chrome mock is
 * needed for transport. chrome.i18n is stubbed minimally because the panel
 * reads labels through getMessageOr / getMessageWithSubstitutions.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { waitForMock } from '../../../testDir/waitPolicy.js';
import { drainMacrotask } from '../../../testDir/waitPolicy.js';
import type { ResponseForType } from '../../messaging/types.js';

// Compile-time pins: these branches must resolve to the pause shapes, not
// the SuccessResponse fallback (brand-checked by `npm run type-check`).
type PauseResponse = ResponseForType<'PAUSE_RECORDING'>;
type ResumeResponse = ResponseForType<'RESUME_RECORDING'>;
type PauseStateResponse = ResponseForType<'GET_PAUSE_STATE'>;
const _pauseOk: PauseResponse = { success: true, pausedUntil: 1 };
const _pauseErr: PauseResponse = { success: false, error: 'INVALID_PAUSE_MINUTES' };
const _resumeOk: ResumeResponse = { success: true };
const _stateOk: PauseStateResponse = { success: true, pausedUntil: null };
void _pauseOk;
void _pauseErr;
void _resumeOk;
void _stateOk;

const FIXED_NOW = 1_760_000_000_000;

function setPanelDom(): void {
  document.body.innerHTML =
    '<button id="pauseBtn" aria-label="Pause auto-save"></button>' +
    '<button id="resumeBtn" class="hidden" aria-label="Resume now"></button>' +
    '<span id="pauseStateLabel" aria-live="polite"></span>';
}

type SendFn = (message: Record<string, unknown>) => Promise<unknown>;

const PRESS_STEPS = [30, 60, 90, 120];

function createSend(initialState: number | null = null): SendFn & { calls: unknown[] } {
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
  }) as SendFn & { calls: unknown[] };
  send.calls = calls;
  return send;
}

describe('pausePanel', () => {
  describe('initPausePanel', () => {
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

    it('pauses 30 minutes on the first press from idle', async () => {
      setPanelDom();
      const send = createSend();
      const { initPausePanel } = await import('../pausePanel.js');
      initPausePanel({ sendMessage: send, now: () => FIXED_NOW });

      (document.getElementById('pauseBtn') as HTMLButtonElement).click();

      await waitForMock(() =>
        expect(send.calls).toContainEqual({
          type: 'PAUSE_RECORDING',
          payload: { minutes: 30 },
        }),
      );
    });

    it('extends to 60 minutes on the second press', async () => {
      setPanelDom();
      const send = createSend(FIXED_NOW + 30 * 60_000);
      const { initPausePanel } = await import('../pausePanel.js');
      initPausePanel({ sendMessage: send, now: () => FIXED_NOW });

      (document.getElementById('pauseBtn') as HTMLButtonElement).click();

      await waitForMock(() =>
        expect(send.calls).toContainEqual({
          type: 'PAUSE_RECORDING',
          payload: { minutes: 60 },
        }),
      );
    });

    it('caps accumulated presses at 120 minutes', async () => {
      setPanelDom();
      const send = createSend(FIXED_NOW + 100 * 60_000);
      const { initPausePanel } = await import('../pausePanel.js');
      initPausePanel({ sendMessage: send, now: () => FIXED_NOW });

      (document.getElementById('pauseBtn') as HTMLButtonElement).click();

      await waitForMock(() =>
        expect(send.calls).toContainEqual({
          type: 'PAUSE_RECORDING',
          payload: { minutes: 120 },
        }),
      );
    });

    it('snaps a late press up without shortening the deadline', async () => {
      setPanelDom();
      const send = createSend(FIXED_NOW + 5 * 60_000);
      const { initPausePanel } = await import('../pausePanel.js');
      initPausePanel({ sendMessage: send, now: () => FIXED_NOW });

      (document.getElementById('pauseBtn') as HTMLButtonElement).click();

      // 5 remaining + 30 = 35 → snaps up to 60 (never down to 30).
      await waitForMock(() =>
        expect(send.calls).toContainEqual({
          type: 'PAUSE_RECORDING',
          payload: { minutes: 60 },
        }),
      );
    });

    it('falls back to 30 minutes when the state query fails', async () => {
      setPanelDom();
      const send = vi.fn(async (message: Record<string, unknown>): Promise<unknown> => {
        if (message.type === 'GET_PAUSE_STATE') {
          return { success: false, error: 'STATE_FAILED' };
        }
        return { success: true, pausedUntil: FIXED_NOW + 30 * 60_000 };
      });
      const { initPausePanel } = await import('../pausePanel.js');
      initPausePanel({ sendMessage: send, now: () => FIXED_NOW });

      (document.getElementById('pauseBtn') as HTMLButtonElement).click();

      await waitForMock(() =>
        expect(send).toHaveBeenCalledWith({
          type: 'PAUSE_RECORDING',
          payload: { minutes: 30 },
        }),
      );
    });

    it('sends RESUME_RECORDING on resume button click', async () => {
      setPanelDom();
      const send = createSend(FIXED_NOW + 30 * 60_000);
      const { initPausePanel } = await import('../pausePanel.js');
      initPausePanel({ sendMessage: send, now: () => FIXED_NOW });

      (document.getElementById('resumeBtn') as HTMLButtonElement).click();

      await waitForMock(() =>
        expect(send.calls).toContainEqual({ type: 'RESUME_RECORDING' }),
      );
    });

    it('shows approximate remaining minutes after pausing, never exact seconds', async () => {
      setPanelDom();
      const send = createSend();
      const { initPausePanel } = await import('../pausePanel.js');
      initPausePanel({ sendMessage: send, now: () => FIXED_NOW });

      (document.getElementById('pauseBtn') as HTMLButtonElement).click();

      await waitForMock(() =>
        expect(
          (document.getElementById('pauseStateLabel') as HTMLElement).textContent,
        ).toContain('30'),
      );
      const label = (document.getElementById('pauseStateLabel') as HTMLElement).textContent ?? '';
      expect(label).not.toMatch(/\d\s?(s|sec|second|秒)/i);
    });

    it('shows the idle label when no pause is active', async () => {
      setPanelDom();
      const send = createSend(null);
      const { initPausePanel } = await import('../pausePanel.js');
      initPausePanel({ sendMessage: send, now: () => FIXED_NOW });
      await drainMacrotask();
      expect((document.getElementById('pauseStateLabel') as HTMLElement).textContent).toBe(
        '記録中',
      );
    });

    it('renders idle when the stored pause has already expired', async () => {
      setPanelDom();
      const send = createSend(FIXED_NOW - 60_000);
      const { initPausePanel } = await import('../pausePanel.js');
      initPausePanel({ sendMessage: send, now: () => FIXED_NOW });
      await drainMacrotask();
      expect((document.getElementById('pauseStateLabel') as HTMLElement).textContent).toBe(
        '記録中',
      );
      expect(
        (document.getElementById('resumeBtn') as HTMLButtonElement).classList.contains(
          'hidden',
        ),
      ).toBe(true);

      // Boundary: expiry exactly now agrees with the strict `now < until` gate.
      setPanelDom();
      const sendExact = createSend(FIXED_NOW);
      initPausePanel({ sendMessage: sendExact, now: () => FIXED_NOW });
      await drainMacrotask();
      expect((document.getElementById('pauseStateLabel') as HTMLElement).textContent).toBe(
        '記録中',
      );
    });

    it('does not show Resumed when the resume request fails', async () => {
      setPanelDom();
      const send = vi.fn(async (message: Record<string, unknown>): Promise<unknown> => {
        if (message.type === 'RESUME_RECORDING') {
          return { success: false, error: 'RESUME_FAILED' };
        }
        return { success: true, pausedUntil: FIXED_NOW + 30 * 60_000 };
      });
      const { initPausePanel } = await import('../pausePanel.js');
      initPausePanel({ sendMessage: send, now: () => FIXED_NOW });
      await drainMacrotask();

      (document.getElementById('resumeBtn') as HTMLButtonElement).click();
      await drainMacrotask();
      const label = (document.getElementById('pauseStateLabel') as HTMLElement);
      expect(label.textContent).not.toBe('再開しました');
      expect(label.textContent).toBe('一時停止の操作に失敗しました');
      // Still paused — the resume button stays visible.
      expect(
        (document.getElementById('resumeBtn') as HTMLButtonElement).classList.contains(
          'hidden',
        ),
      ).toBe(false);
    });

    it('shows an error label when the pause request is rejected', async () => {
      setPanelDom();
      const send = vi.fn(async (message: Record<string, unknown>): Promise<unknown> => {
        if (message.type === 'PAUSE_RECORDING') {
          return { success: false, error: 'INVALID_PAUSE_MINUTES' };
        }
        return { success: true, pausedUntil: null };
      });
      const { initPausePanel } = await import('../pausePanel.js');
      initPausePanel({ sendMessage: send, now: () => FIXED_NOW });

      (document.getElementById('pauseBtn') as HTMLButtonElement).click();
      await drainMacrotask();
      expect(
        (document.getElementById('pauseStateLabel') as HTMLElement).textContent,
      ).not.toBe('記録中');
    });

    it('toggles resume button visibility with pause state', async () => {
      setPanelDom();
      const send = createSend(null);
      const { initPausePanel } = await import('../pausePanel.js');
      initPausePanel({ sendMessage: send, now: () => FIXED_NOW });

      const resumeBtn = document.getElementById('resumeBtn') as HTMLButtonElement;
      await drainMacrotask();
      expect(resumeBtn.classList.contains('hidden')).toBe(true);

      (document.getElementById('pauseBtn') as HTMLButtonElement).click();
      await waitForMock(() => expect(resumeBtn.classList.contains('hidden')).toBe(false));

      resumeBtn.click();
      await waitForMock(() => expect(resumeBtn.classList.contains('hidden')).toBe(true));
    });

    it('keeps keyboard-operable controls with accessible names', async () => {
      setPanelDom();
      const send = createSend();
      const { initPausePanel } = await import('../pausePanel.js');
      initPausePanel({ sendMessage: send, now: () => FIXED_NOW });
      await drainMacrotask();

      const pauseBtn = document.getElementById('pauseBtn') as HTMLElement;
      const resumeBtn = document.getElementById('resumeBtn') as HTMLElement;
      expect(pauseBtn.tagName).toBe('BUTTON');
      expect(resumeBtn.tagName).toBe('BUTTON');
      expect(pauseBtn.getAttribute('aria-label')).toBeTruthy();
      expect(resumeBtn.getAttribute('aria-label')).toBeTruthy();
      expect(document.getElementById('pauseStateLabel')?.getAttribute('aria-live')).toBe(
        'polite',
      );
    });

    it('re-asserts the toolbar countdown when opening while paused', async () => {
      setPanelDom();
      const setBadgeText = vi.fn();
      (globalThis as Record<string, unknown>).chrome = {
        i18n: { getMessage: () => '' },
        action: { setBadgeText },
      };
      const send = createSend(FIXED_NOW + 30 * 60_000);
      const { initPausePanel } = await import('../pausePanel.js');
      initPausePanel({ sendMessage: send, now: () => FIXED_NOW });
      await drainMacrotask();
      expect(setBadgeText).toHaveBeenCalledWith({ text: '30' });
    });

    it('does not touch the toolbar badge when idle', async () => {
      setPanelDom();
      const setBadgeText = vi.fn();
      (globalThis as Record<string, unknown>).chrome = {
        i18n: { getMessage: () => '' },
        action: { setBadgeText },
      };
      const send = createSend(null);
      const { initPausePanel } = await import('../pausePanel.js');
      initPausePanel({ sendMessage: send, now: () => FIXED_NOW });
      await drainMacrotask();
      expect(setBadgeText).not.toHaveBeenCalled();
    });

    it('does nothing when the pause button is absent', async () => {
      document.body.innerHTML = '<span id="pauseStateLabel"></span>';
      const send = createSend();
      const { initPausePanel } = await import('../pausePanel.js');

      expect(() => initPausePanel({ sendMessage: send, now: () => FIXED_NOW })).not.toThrow();
      await drainMacrotask();
    });

    it('snaps press targets up into 30/60/90/120 with a 120 cap', async () => {
      const { snapPressMinutes } = await import('../pausePanel.js');
      expect(snapPressMinutes(0)).toBe(30);
      expect(snapPressMinutes(30 * 60_000)).toBe(30);
      expect(snapPressMinutes(30 * 60_000 + 1)).toBe(60);
      expect(snapPressMinutes(90 * 60_000)).toBe(90);
      expect(snapPressMinutes(91 * 60_000)).toBe(120);
      expect(snapPressMinutes(500 * 60_000)).toBe(120);
    });
  });
});
