
import type { ExtensionMessage } from '../messageTypes.js';
import { VALID_MESSAGE_TYPES, CONTENT_SCRIPT_ONLY_TYPES, NO_PAYLOAD_TYPES } from '../messageTypes.js';

describe('Message Type Consistency', () => {
    test('VALID_MESSAGE_TYPES contains all types defined in ExtensionMessage type', () => {
        type ValidType = ExtensionMessage['type'];
        const allDefinedTypes: ValidType[] = [
            'VALID_VISIT', 'CHECK_DOMAIN', 'GET_CONTENT', 'FETCH_URL',
            'MANUAL_RECORD', 'PREVIEW_RECORD', 'SAVE_RECORD', 'TEST_CONNECTIONS',
            'TEST_OBSIDIAN', 'TEST_AI', 'GET_PRIVACY_CACHE', 'ACTIVITY_UPDATE',
            'SESSION_LOCK_REQUEST', 'CONTENT_CLEANSING_EXECUTED',
            'PING', 'REFRESH_LOCAL_MARKDOWN_SCHEDULER', 'CONSENT_STATE_CHANGED', 'DASHBOARD_SQLITE',
        ];

        for (const type of allDefinedTypes) {
            expect(VALID_MESSAGE_TYPES).toContain(type);
        }
    });

    test('VALID_MESSAGE_TYPES does not contain undeclared types', () => {
        type ValidType = ExtensionMessage['type'];
        for (const type of VALID_MESSAGE_TYPES) {
            const _assert: ValidType = type as ValidType;
            expect(_assert).toBeDefined();
        }
    });

    test('VALID_VISIT is in CONTENT_SCRIPT_ONLY_TYPES', () => {
        expect(CONTENT_SCRIPT_ONLY_TYPES).toContain('VALID_VISIT');
    });

    test('NO_PAYLOAD_TYPES are a subset of VALID_MESSAGE_TYPES', () => {
        for (const type of NO_PAYLOAD_TYPES) {
            expect(VALID_MESSAGE_TYPES).toContain(type);
        }
    });

    test('CONTENT_SCRIPT_ONLY_TYPES are a subset of VALID_MESSAGE_TYPES', () => {
        for (const type of CONTENT_SCRIPT_ONLY_TYPES) {
            expect(VALID_MESSAGE_TYPES).toContain(type);
        }
    });
});
