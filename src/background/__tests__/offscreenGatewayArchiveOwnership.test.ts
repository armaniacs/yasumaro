/**
 * offscreenGatewayArchiveOwnership.test.ts (PBI 2026-09-25-29, Phase A slice A2)
 *
 * Pre-split ownership baseline (structure pin, no production change).
 *
 * The PBI acceptance criteria require a structure test pinning that archive
 * routing is owned by `ArchiveGateway`. Before the split, that class does not
 * exist yet: archive routing still lives inside `OffscreenGateway.execute`
 * (the `isArchiveOpType` branch in `src/background/sqlite/offscreenGateway.ts`)
 * and `SqliteClient` is an alias of `OffscreenGateway`.
 *
 * These tests pin that current ownership. When the split moves archive routing
 * to `ArchiveGateway`, the "owns archive routing" and "has no ArchiveGateway
 * export" tests fail, which is the intended tripwire.
 */
import { describe, it, expect } from 'vitest';
import * as gatewayModule from '../sqlite/offscreenGateway.js';
import { OffscreenGateway, SqliteClient } from '../sqlite/offscreenGateway.js';
import type { OffscreenTransport } from '../offscreenTransport.js';
import type { OffscreenResponse, SqliteMessageType } from '../../messaging/sqliteMessages.js';

function recordingTransport(response: OffscreenResponse): OffscreenTransport & {
  calls: Array<{ type: SqliteMessageType; payload: Record<string, unknown> }>;
} {
  const calls: Array<{ type: SqliteMessageType; payload: Record<string, unknown> }> = [];
  return {
    calls,
    async msgOffscreen(
      type: SqliteMessageType,
      payload: Record<string, unknown> = {},
    ): Promise<OffscreenResponse> {
      calls.push({ type, payload });
      return response;
    },
  };
}

describe('offscreenGatewayArchiveOwnership', () => {
  describe('archive routing owner (pre-split baseline)', () => {
    it('has no ArchiveGateway export yet', () => {
      expect('ArchiveGateway' in gatewayModule).toBe(false);
    });

    it('owns archive routing inside OffscreenGateway', async () => {
      const transport = recordingTransport({ success: true, status: {} } as OffscreenResponse);
      const client = new OffscreenGateway(transport);

      const result = await client.maintain({ type: 'archiveStatus' });

      expect(result).toEqual({ success: true, data: {} });
      expect(transport.calls).toEqual([{ type: 'SQLITE_ARCHIVE_STATUS', payload: {} }]);
    });

    it('routes archive and non-archive ops through the same injected transport', async () => {
      const transport = recordingTransport({ success: true, status: {} } as OffscreenResponse);
      const client = new OffscreenGateway(transport);

      await client.maintain({ type: 'archiveStatus' });
      await client.maintain({ type: 'init' });

      expect(transport.calls).toEqual([
        { type: 'SQLITE_ARCHIVE_STATUS', payload: {} },
        { type: 'SQLITE_INIT', payload: {} },
      ]);
    });

    it('keeps SqliteClient facade aliased to OffscreenGateway', () => {
      expect(SqliteClient).toBe(OffscreenGateway);
    });

    it('keeps query, getStatus, mutate and maintain on OffscreenGateway', () => {
      for (const method of ['query', 'mutate', 'maintain', 'execute', 'status', 'getStatus'] as const) {
        expect(typeof (OffscreenGateway.prototype as Record<string, unknown>)[method]).toBe('function');
      }
    });
  });
});
