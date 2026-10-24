import { describe, expect, it, vi } from 'vitest';
import { CONTENT_SCRIPT_ALLOWED_TYPES } from '../../messageTypes.js';
import { createGetPauseStateHandler, createPauseRecordingHandler, createResumeRecordingHandler } from '../pauseHandlers.js';

describe('pauseHandlers', () => {
  it('rejects minutes outside 30/60/90/120', async () => {
    const schedule = vi.fn(async () => 0);
    const handler = createPauseRecordingHandler({ schedulePause: schedule });
    const sendResponse = vi.fn();
    await handler({ type: 'PAUSE_RECORDING', payload: { minutes: 45 } } as never, {} as never, sendResponse);
    expect(schedule).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'INVALID_PAUSE_MINUTES' });
  });

  it('rejects non-number and missing minutes without calling schedule', async () => {
    const schedule = vi.fn(async () => 0);
    for (const minutes of ['90', undefined, null]) {
      const sendResponse = vi.fn();
      await createPauseRecordingHandler({ schedulePause: schedule })(
        { type: 'PAUSE_RECORDING', payload: { minutes } } as never,
        {} as never,
        sendResponse,
      );
      expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'INVALID_PAUSE_MINUTES' });
    }
    expect(schedule).not.toHaveBeenCalled();
  });

  it('accepts the 90-minute press step', async () => {
    const schedule = vi.fn(async () => 99);
    const sendResponse = vi.fn();
    await createPauseRecordingHandler({ schedulePause: schedule })({ type: 'PAUSE_RECORDING', payload: { minutes: 90 } } as never, {} as never, sendResponse);
    expect(schedule).toHaveBeenCalledWith(90);
    expect(sendResponse).toHaveBeenCalledWith({ success: true, pausedUntil: 99 });
  });

  it('pauses and resumes through injected seams', async () => {
    const schedule = vi.fn(async () => 123);
    const clear = vi.fn(async () => undefined);
    const sendResponse = vi.fn();
    await createPauseRecordingHandler({ schedulePause: schedule })({ type: 'PAUSE_RECORDING', payload: { minutes: 30 } } as never, {} as never, sendResponse);
    expect(schedule).toHaveBeenCalledWith(30);
    await createResumeRecordingHandler({ clearPause: clear })({ type: 'RESUME_RECORDING' } as never, {} as never, sendResponse);
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('returns pausedUntil for state queries', async () => {
    const sendResponse = vi.fn();
    await createGetPauseStateHandler({ getState: async () => 456 })({ type: 'GET_PAUSE_STATE' } as never, {} as never, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ success: true, pausedUntil: 456 });
  });

  it('keeps pause messages extension-only', () => {
    expect(CONTENT_SCRIPT_ALLOWED_TYPES).not.toContain('PAUSE_RECORDING');
    expect(CONTENT_SCRIPT_ALLOWED_TYPES).not.toContain('RESUME_RECORDING');
    expect(CONTENT_SCRIPT_ALLOWED_TYPES).not.toContain('GET_PAUSE_STATE');
  });
});
