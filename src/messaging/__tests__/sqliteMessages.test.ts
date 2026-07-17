/**
 * Unit tests for src/messaging/sqliteMessages.ts
 * Target: isSqliteMessageType, SQLITE_MESSAGE_TYPES
 */
import { describe, it, expect } from 'vitest';
import { isSqliteMessageType, SQLITE_MESSAGE_TYPES } from '../sqliteMessages.js';

describe('messaging/sqliteMessages: isSqliteMessageType', () => {
    it('returns false for non-string values', () => {
        expect(isSqliteMessageType(null)).toBe(false);
        expect(isSqliteMessageType(undefined)).toBe(false);
        expect(isSqliteMessageType(123)).toBe(false);
        expect(isSqliteMessageType({})).toBe(false);
    });

    it('returns false for an unregistered type', () => {
        expect(isSqliteMessageType('UNKNOWN_TYPE')).toBe(false);
    });

    it('returns false for a SQLITE_-prefixed type that is not in the union', () => {
        expect(isSqliteMessageType('SQLITE_NOT_A_REAL_TYPE')).toBe(false);
    });

    it('returns false for non-SQLite messages handled elsewhere in offscreen.ts', () => {
        expect(isSqliteMessageType('CHECK_AVAILABILITY')).toBe(false);
        expect(isSqliteMessageType('SUMMARIZE')).toBe(false);
    });

    it('returns true for every registered SqliteMessage type', () => {
        for (const type of SQLITE_MESSAGE_TYPES) {
            expect(isSqliteMessageType(type)).toBe(true);
        }
    });

    it('returns true for CONTENT_PURGE despite lacking the SQLITE_ prefix', () => {
        expect(isSqliteMessageType('CONTENT_PURGE')).toBe(true);
    });
});
