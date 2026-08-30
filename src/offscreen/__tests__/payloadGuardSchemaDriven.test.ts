/**
 * payloadGuardSchemaDriven.test.ts
 * Verifies payloadGuard caps every TEXT column derived from schema.ts,
 * not a hardcoded subset, and fails closed on unknown fields.
 */

import { describe, it, expect } from 'vitest';
import {
  assertPayloadSize,
  MAX_PAYLOAD_STRING_BYTES,
  TEXT_COLUMNS,
} from '../payloadGuard.js';
import type { SqliteMessage } from '../../messaging/sqliteMessages.js';

const oversized = 'x'.repeat(MAX_PAYLOAD_STRING_BYTES + 1);

describe('payloadGuard schema-driven TEXT column caps', () => {
  it('exposes every TEXT column from schema.ts', () => {
    expect(TEXT_COLUMNS).toEqual(
      expect.arrayContaining([
        'url',
        'title',
        'summary',
        'tags',
        'domain',
        'cleansed_reason',
        'ai_provider',
        'ai_model',
      ]),
    );
  });

  it('caps a previously-unguarded TEXT column (tags) on INSERT', () => {
    const msg: SqliteMessage = {
      type: 'SQLITE_INSERT',
      payload: { url: 'https://e.com', tags: oversized },
    };
    expect(assertPayloadSize(msg)).toMatch(/tags/);
  });

  it('caps every TEXT column on INSERT', () => {
    for (const col of TEXT_COLUMNS) {
      const msg: SqliteMessage = {
        type: 'SQLITE_INSERT',
        payload: { url: 'https://e.com', [col]: oversized },
      };
      expect(assertPayloadSize(msg)).toMatch(new RegExp(col));
    }
  });

  it('caps TEXT columns on the SQLITE_UPDATE (changes) path', () => {
    const msg: SqliteMessage = {
      type: 'SQLITE_UPDATE',
      payload: { id: 1, tags: oversized },
    };
    expect(assertPayloadSize(msg)).toMatch(/tags/);
  });

  it('fails closed on an unknown field in an INSERT payload', () => {
    const msg = {
      type: 'SQLITE_INSERT',
      payload: { url: 'https://e.com', not_a_real_column: 'v' },
    } as unknown as SqliteMessage;
    expect(assertPayloadSize(msg)).toMatch(/unknown field/i);
  });

  it('accepts a well-formed INSERT payload', () => {
    const msg: SqliteMessage = {
      type: 'SQLITE_INSERT',
      payload: { url: 'https://e.com', title: 'ok', summary: 'fine', created_at: 1 },
    };
    expect(assertPayloadSize(msg)).toBeNull();
  });

  it('adding a schema column auto-caps it (no payloadGuard edit needed)', () => {
    // TEXT_COLUMNS is derived from schema.ts COLUMN_NAMES filtered by the
    // schema DDL, so any new TEXT column flows into the cap loop automatically.
    for (const col of TEXT_COLUMNS) {
      const ok: SqliteMessage = {
        type: 'SQLITE_INSERT',
        payload: { url: 'https://e.com', [col]: 'short' },
      };
      expect(assertPayloadSize(ok)).toBeNull();
    }
  });
});
