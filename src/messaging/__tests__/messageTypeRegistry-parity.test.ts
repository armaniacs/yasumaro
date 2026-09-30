/**
 * messageTypeRegistry-parity.test.ts
 * Pins message-type constants and validator behaviour before the move to
 * src/messaging/messageTypeRegistry.ts. Expectations are copies of the
 * current values; the refactor must not change them.
 */
import { describe, it, expect } from 'vitest';
import {
    AI_TEST_PROGRESS_MESSAGE_TYPE,
    VALID_MESSAGE_TYPES,
    CONTENT_SCRIPT_ALLOWED_TYPES,
    NO_PAYLOAD_TYPES,
} from '../../background/messageTypes.js';
import { CURRENT_PROTOCOL_VERSION } from '../protocol.js';
import { isServiceWorkerRequest } from '../types.js';
import { fetchUrlValidator, ValidationError } from '../validators.js';
import { TOKEN_REQUIRED_SUBTYPES } from '../sqliteOperationSecurity.js';

describe('messaging parity: message type registry', () => {
    it('pins VALID_MESSAGE_TYPES order and count', () => {
        expect([...VALID_MESSAGE_TYPES]).toEqual([
            'VALID_VISIT',
            'CHECK_DOMAIN',
            'GET_CONTENT',
            'FETCH_URL',
            'MANUAL_RECORD',
            'PREVIEW_RECORD',
            'SAVE_RECORD',
            'REGENERATE_SUMMARY',
            'TEST_CONNECTIONS',
            'TEST_OBSIDIAN',
            'TEST_AI',
            'GET_PRIVACY_CACHE',
            'ACTIVITY_UPDATE',
            'SESSION_LOCK_REQUEST',
            'CONTENT_CLEANSING_EXECUTED',
            'PING',
            'REFRESH_LOCAL_MARKDOWN_SCHEDULER',
            'CONSENT_STATE_CHANGED',
            'DASHBOARD_SQLITE',
            'GENERATE_REVIEW_SUMMARY',
            'LOG_FORWARD',
        ]);
    });

    it('pins CONTENT_SCRIPT_ALLOWED_TYPES', () => {
        expect([...CONTENT_SCRIPT_ALLOWED_TYPES]).toEqual([
            'VALID_VISIT',
            'CONTENT_CLEANSING_EXECUTED',
            'CHECK_DOMAIN',
            'PING',
        ]);
    });

    it('pins NO_PAYLOAD_TYPES', () => {
        expect([...NO_PAYLOAD_TYPES]).toEqual([
            'CHECK_DOMAIN',
            'GET_CONTENT',
            'GET_PRIVACY_CACHE',
            'ACTIVITY_UPDATE',
            'SESSION_LOCK_REQUEST',
            'PING',
            'REFRESH_LOCAL_MARKDOWN_SCHEDULER',
            'CONSENT_STATE_CHANGED',
            'TEST_CONNECTIONS',
            'TEST_AI',
        ]);
    });

    it('pins AI_TEST_PROGRESS_MESSAGE_TYPE outside VALID_MESSAGE_TYPES', () => {
        expect(AI_TEST_PROGRESS_MESSAGE_TYPE).toBe('AI_TEST_PROGRESS');
        expect((VALID_MESSAGE_TYPES as readonly string[]).includes(AI_TEST_PROGRESS_MESSAGE_TYPE)).toBe(false);
    });

    it('pins CURRENT_PROTOCOL_VERSION', () => {
        expect(CURRENT_PROTOCOL_VERSION).toBe(1);
    });

    it('pins isServiceWorkerRequest observations', () => {
        expect(isServiceWorkerRequest({ type: 'PING' })).toBe(true);
        expect(isServiceWorkerRequest({ type: 'PING', payload: {} })).toBe(false);
        expect(isServiceWorkerRequest({ type: 'NOPE' })).toBe(false);
        expect(isServiceWorkerRequest({ type: 'VALID_VISIT' })).toBe(false);
        expect(isServiceWorkerRequest({ type: 'VALID_VISIT', payload: {} })).toBe(true);
        expect(isServiceWorkerRequest({ type: 'DASHBOARD_SQLITE' })).toBe(true);
    });

    it('pins fetchUrlValidator scheme handling', () => {
        expect(() =>
            fetchUrlValidator.validate({
                type: 'FETCH_URL',
                payload: { url: 'ftp://example.com' },
                protocolVersion: 1,
            }),
        ).toThrow(ValidationError);
        expect(
            fetchUrlValidator.validate({
                type: 'FETCH_URL',
                payload: { url: 'http://example.com' },
                protocolVersion: 1,
            }),
        ).toMatchObject({ type: 'FETCH_URL' });
        expect(
            fetchUrlValidator.validate({
                type: 'FETCH_URL',
                payload: { url: 'https://example.com' },
                protocolVersion: 1,
            }),
        ).toMatchObject({ type: 'FETCH_URL' });
    });

    it('pins TOKEN_REQUIRED_SUBTYPES snapshot', () => {
        expect(TOKEN_REQUIRED_SUBTYPES).toBeInstanceOf(Set);
        expect(TOKEN_REQUIRED_SUBTYPES.size).toBe(24);
        expect([...TOKEN_REQUIRED_SUBTYPES].sort()).toEqual([
            'append_to_obsidian',
            'archive_cleanup',
            'archive_close',
            'archive_create',
            'archive_delete_by_staging',
            'archive_export',
            'archive_open',
            'archive_prepare_incoming',
            'archive_restore',
            'archive_save',
            'archive_update',
            'backfill_metadata',
            'backup_db',
            'cleanup_legacy',
            'clear_all',
            'content_purge_now',
            'delete',
            'import',
            'migrate',
            'purge_now',
            'restore_db',
            'resync_legacy',
            'toggle_star',
            'update',
        ]);
    });
});
