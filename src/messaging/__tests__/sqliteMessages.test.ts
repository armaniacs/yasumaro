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

describe('messaging/sqliteMessages: the union and the array agree', () => {
    /**
     * A type present in the union but missing from the array type-checks
     * cleanly while offscreen.ts silently rejects that message at runtime.
     * The compile-time guard against that lives in sqliteMessages.ts, since
     * types are erased and a test cannot enumerate a union; what a test can
     * do is pin the array so an entry cannot be dropped unnoticed.
     */
    it('covers every message the SW can send to offscreen', () => {
        expect(SQLITE_MESSAGE_TYPES).toHaveLength(20);
        expect(new Set(SQLITE_MESSAGE_TYPES).size).toBe(SQLITE_MESSAGE_TYPES.length);
    });

    it('lists the messages that have no other caller to notice their absence', () => {
        // opfs_spike and content purge are reached from a single call site each,
        // so a missing entry would not show up in any other test.
        expect(SQLITE_MESSAGE_TYPES).toContain('SQLITE_OPFS_SPIKE');
        expect(SQLITE_MESSAGE_TYPES).toContain('CONTENT_PURGE');
    });
});
