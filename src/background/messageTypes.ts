/**
 * messageTypes.ts
 * Service Worker message type constants.
 * Extracted from service-worker.ts for testability — importing this file
 * does NOT trigger Chrome API side effects.
 */

export const VALID_MESSAGE_TYPES = [
    'VALID_VISIT',
    'CHECK_DOMAIN',
    'GET_CONTENT',
    'FETCH_URL',
    'MANUAL_RECORD',
    'PREVIEW_RECORD',
    'SAVE_RECORD',
    'TEST_CONNECTIONS',
    'TEST_OBSIDIAN',
    'TEST_AI',
    'GET_PRIVACY_CACHE',
    'ACTIVITY_UPDATE',
    'SESSION_LOCK_REQUEST',
    'CONTENT_CLEANSING_EXECUTED',
    'PING', // Service Worker health check
] as const;

export const CONTENT_SCRIPT_ONLY_TYPES = [
    'VALID_VISIT',
    'CHECK_DOMAIN',
] as const;

export const NO_PAYLOAD_TYPES = [
    'CHECK_DOMAIN',
    'GET_PRIVACY_CACHE',
    'ACTIVITY_UPDATE',
    'SESSION_LOCK_REQUEST',
    'PING',
] as const;
