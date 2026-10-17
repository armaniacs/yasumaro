/**
 * pauseHandlers.ts
 * Popup-initiated recording-pause handlers (PBI 2026-10-17-01).
 *
 * Small module next to recordingPause.ts: each factory takes only its
 * minimal seam ({ schedulePause } etc.), so tests inject fakes and never
 * touch chrome.storage or chrome.alarms. Extension-only trust comes from
 * the router (types are absent from CONTENT_SCRIPT_ALLOWED_TYPES).
 */

import type {
    PauseRecordingMessage,
    ResumeRecordingMessage,
    GetPauseStateMessage,
} from '../messageTypes.js';
import { isValidPreset, type PausePresetMinutes } from '../recordingPause.js';

export interface PauseRecordingHandlerDeps {
    schedulePause: (minutes: PausePresetMinutes) => Promise<number>;
}

export interface ResumeRecordingHandlerDeps {
    clearPause: () => Promise<void>;
}

export interface GetPauseStateHandlerDeps {
    getState: () => Promise<number | null>;
}

export function createPauseRecordingHandler(deps: PauseRecordingHandlerDeps) {
    return async (
        message: PauseRecordingMessage,
        _sender: chrome.runtime.MessageSender,
        sendResponse: (response?: unknown) => void,
    ): Promise<void> => {
        // Defensive runtime read: the wire can carry anything, so validate
        // against the preset set instead of trusting the declared type.
        const minutes = (message as { payload?: { minutes?: unknown } }).payload?.minutes;
        if (typeof minutes !== 'number' || !isValidPreset(minutes)) {
            sendResponse({ success: false, error: 'INVALID_PAUSE_MINUTES' });
            return;
        }
        const pausedUntil = await deps.schedulePause(minutes);
        sendResponse({ success: true, pausedUntil });
    };
}

export function createResumeRecordingHandler(deps: ResumeRecordingHandlerDeps) {
    return async (
        _message: ResumeRecordingMessage,
        _sender: chrome.runtime.MessageSender,
        sendResponse: (response?: unknown) => void,
    ): Promise<void> => {
        await deps.clearPause();
        sendResponse({ success: true });
    };
}

export function createGetPauseStateHandler(deps: GetPauseStateHandlerDeps) {
    return async (
        _message: GetPauseStateMessage,
        _sender: chrome.runtime.MessageSender,
        sendResponse: (response?: unknown) => void,
    ): Promise<void> => {
        const pausedUntil = await deps.getState();
        sendResponse({ success: true, pausedUntil });
    };
}
