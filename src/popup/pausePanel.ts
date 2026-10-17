/**
 * pausePanel.ts
 * Popup pause controls (PBI 2026-10-17-01 Task 6, press model follow-up).
 *
 * Owns the pause button, the resume button, and the pause-state label.
 * statusPanel.ts is untouched — this module is the sole writer of the
 * pause DOM. All strings go through i18n (getMessageOr /
 * getMessageWithSubstitutions); the DOM is built with textContent only
 * (CSP-safe, no innerHTML). Controls are native buttons so they stay
 * keyboard operable.
 *
 * Press model: every pause-button press extends the deadline by 30 min up
 * to PAUSE_MAX_MINUTES (1 press ≈ 30, 2 presses ≈ 60, 4 presses ≈ 120).
 * The remaining-minutes countdown also shows on the toolbar badge
 * (background ticker); the label shows an approximate remaining time
 * ("約○分" / "about N min") — never exact resume seconds.
 */
import { getMessageOr, getMessageWithSubstitutions } from '../utils/i18n.js';
import { messageTransport } from '../messaging/messageTransport.js';
import type { ResponseForType } from '../messaging/types.js';

export type PausePresetMinutes = 30 | 60 | 90 | 120;

type PauseRecordingResponse = ResponseForType<'PAUSE_RECORDING'>;
type ResumeRecordingResponse = ResponseForType<'RESUME_RECORDING'>;
type PauseStateResponse = ResponseForType<'GET_PAUSE_STATE'>;

export interface PausePanelDeps {
  sendMessage?: (message: Record<string, unknown>) => Promise<unknown>;
  now?: () => number;
}

/**
 * Press steps mirror the background SSOT
 * (`PAUSE_PRESETS_MINUTES` in recordingPause.js), which re-validates every
 * request. Kept local: popup must not import background modules.
 */
const PRESS_STEPS: readonly PausePresetMinutes[] = [30, 60, 90, 120];
const PRESS_INCREMENT_MS = 30 * 60_000;
const PRESS_CAP_MS = 120 * 60_000;

/** Snap a target duration up into the valid set (never shorten, cap 120). */
export function snapPressMinutes(targetMs: number): PausePresetMinutes {
  const mins = Math.ceil(targetMs / 60_000);
  for (const step of PRESS_STEPS) {
    if (mins <= step) return step;
  }
  return 120;
}

function setLabel(text: string): void {
  const label = document.getElementById('pauseStateLabel');
  if (label) label.textContent = text;
}

function setResumedVisible(paused: boolean): void {
  const resumeBtn = document.getElementById('resumeBtn') as HTMLButtonElement | null;
  if (!resumeBtn) return;
  // The popup stylesheet hides via `.hidden{display:none!important}`, so the
  // class must be toggled — the `hidden` property alone cannot override it.
  resumeBtn.classList.toggle('hidden', !paused);
  resumeBtn.hidden = !paused;
}

function renderIdle(): void {
  setLabel(getMessageOr('pauseIdle', '記録中'));
  setResumedVisible(false);
}

function renderPaused(pausedUntil: number, now: number): void {
  const mins = Math.max(1, Math.round((pausedUntil - now) / 60_000));
  setLabel(
    getMessageWithSubstitutions('pauseRemaining', { mins: String(mins) }, `約${mins}分停止中`),
  );
  setResumedVisible(true);
}

function renderStateResponse(state: PauseStateResponse | null, now: number): void {
  const until =
    state !== null && state.success === true && typeof state.pausedUntil === 'number'
      ? state.pausedUntil
      : null;
  if (until === null || until <= now) {
    // An expired timestamp claims no protection: the background gates use
    // strict `now < until`, so the label must agree and render idle.
    renderIdle();
    return;
  }
  renderPaused(until, now);
}

async function refreshPauseState(
  send: (message: Record<string, unknown>) => Promise<unknown>,
  now: () => number,
): Promise<void> {
  try {
    const state = (await send({ type: 'GET_PAUSE_STATE' })) as PauseStateResponse;
    if (state === null || state === undefined) {
      renderIdle();
      return;
    }
    renderStateResponse(state, now());
  } catch {
    // Fail-open display: a dead transport means the SW side cannot confirm
    // a pause, so fall back to the idle label instead of throwing.
    renderIdle();
  }
}

/**
 * One press extends the deadline by 30 min (capped at 120 min from now):
 * idle → 30, then ≈60, ≈90, ≈120. A late press adds ~30 on top of whatever
 * remains, snapped up into the valid set so the deadline never shortens.
 */
async function pauseByPress(
  send: (message: Record<string, unknown>) => Promise<unknown>,
  now: () => number,
): Promise<void> {
  let remainingMs = 0;
  try {
    const state = (await send({ type: 'GET_PAUSE_STATE' })) as PauseStateResponse;
    const until =
      state !== null && state.success === true && typeof state.pausedUntil === 'number'
        ? state.pausedUntil
        : null;
    if (until !== null && until > now()) remainingMs = until - now();
  } catch {
    // State unknown — treat as idle (a fresh 30 min press).
  }
  const minutes = snapPressMinutes(Math.min(remainingMs + PRESS_INCREMENT_MS, PRESS_CAP_MS));
  let response: PauseRecordingResponse;
  try {
    response = (await send({ type: 'PAUSE_RECORDING', payload: { minutes } })) as PauseRecordingResponse;
  } catch {
    setLabel(getMessageOr('pauseError', '一時停止の操作に失敗しました'));
    return;
  }
  if (response.success !== true) {
    const error = typeof response.error === 'string' ? response.error : '';
    setLabel(
      error === 'INVALID_PAUSE_MINUTES'
        ? getMessageOr('pauseInvalidMinutes', '無効な一時停止時間です')
        : getMessageOr('pauseError', '一時停止の操作に失敗しました'),
    );
    return;
  }
  // Transient confirmation; refreshPauseState replaces it with the
  // approximate remaining time once the state round-trip lands.
  setLabel(getMessageOr('pauseStarted', '一時停止しました'));
  await refreshPauseState(send, now);
}

async function resumeNow(
  send: (message: Record<string, unknown>) => Promise<unknown>,
  now: () => number,
): Promise<void> {
  let response: ResumeRecordingResponse;
  try {
    response = (await send({ type: 'RESUME_RECORDING' })) as ResumeRecordingResponse;
  } catch {
    setLabel(getMessageOr('pauseError', '一時停止の操作に失敗しました'));
    return;
  }
  if (response.success !== true) {
    setLabel(getMessageOr('pauseError', '一時停止の操作に失敗しました'));
    return;
  }
  // Transient confirmation; refreshPauseState replaces it with the idle
  // label once the state round-trip lands.
  setLabel(getMessageOr('pauseResumed', '再開しました'));
  await refreshPauseState(send, now);
}

export function initPausePanel(deps: PausePanelDeps = {}): void {
  const send =
    deps.sendMessage ??
    ((message: Record<string, unknown>) =>
      messageTransport.send(message as never) as Promise<unknown>);
  const now = deps.now ?? (() => Date.now());
  const pauseBtn = document.getElementById('pauseBtn');
  if (!pauseBtn) return;
  pauseBtn.addEventListener('click', () => {
    void pauseByPress(send, now);
  });
  const resumeBtn = document.getElementById('resumeBtn');
  resumeBtn?.addEventListener('click', () => {
    void resumeNow(send, now);
  });
  void refreshPauseState(send, now);
}
