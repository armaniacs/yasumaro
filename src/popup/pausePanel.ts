/**
 * pausePanel.ts
 * Popup pause controls (PBI 2026-10-17-01 Task 6).
 *
 * Owns the pause button, the preset select, the resume button, and the
 * pause-state label. statusPanel.ts is untouched — this module is the sole
 * writer of the pause DOM. All strings go through i18n (getMessageOr /
 * getMessageWithSubstitutions); the DOM is built with textContent only
 * (CSP-safe, no innerHTML). Controls are native button/select elements so
 * they stay keyboard operable.
 *
 * Display contract (deep-dig decision): the label shows an approximate
 * remaining time ("約○分" / "about N min") — never exact resume seconds.
 */
import { getMessageOr, getMessageWithSubstitutions } from '../utils/i18n.js';
import { messageTransport } from '../messaging/messageTransport.js';
import type { ResponseForType } from '../messaging/types.js';

export type PausePresetMinutes = 30 | 60 | 180;

type PauseRecordingResponse = ResponseForType<'PAUSE_RECORDING'>;
type PauseStateResponse = ResponseForType<'GET_PAUSE_STATE'>;

export interface PausePanelDeps {
  sendMessage?: (message: Record<string, unknown>) => Promise<unknown>;
  now?: () => number;
}

const PRESETS: readonly PausePresetMinutes[] = [30, 60, 180];

function isPresetMinutes(value: number): value is PausePresetMinutes {
  return (PRESETS as readonly number[]).includes(value);
}

function readPresetMinutes(): PausePresetMinutes {
  const select = document.getElementById('pausePreset') as HTMLSelectElement | null;
  if (!select) return 30;
  const value = Number(select.value);
  return isPresetMinutes(value) ? value : 30;
}

function setLabel(text: string): void {
  const label = document.getElementById('pauseStateLabel');
  if (label) label.textContent = text;
}

function setResumedVisible(paused: boolean): void {
  const resumeBtn = document.getElementById('resumeBtn') as HTMLButtonElement | null;
  if (resumeBtn) resumeBtn.hidden = !paused;
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
  if (until === null) {
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
    renderStateResponse(state, now());
  } catch {
    // Fail-open display: a dead transport means the SW side cannot confirm
    // a pause, so fall back to the idle label instead of throwing.
    renderIdle();
  }
}

async function pauseWithPreset(
  send: (message: Record<string, unknown>) => Promise<unknown>,
  now: () => number,
): Promise<void> {
  const minutes = readPresetMinutes();
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
  try {
    await send({ type: 'RESUME_RECORDING' });
  } catch {
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
    void pauseWithPreset(send, now);
  });
  const resumeBtn = document.getElementById('resumeBtn');
  resumeBtn?.addEventListener('click', () => {
    void resumeNow(send, now);
  });
  void refreshPauseState(send, now);
}
