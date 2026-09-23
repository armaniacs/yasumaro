/**
 * sqliteMaintainWireDispatch.test.ts (PBI 2026-09-23-13)
 *
 * Pins the gateway side of the maintain wire-table move: after the 7-branch
 * switch dissolved into `sqliteMaintainWireFor(op.type)` + callInternal, each
 * non-archive maintain op must still emit the identical (messageType,
 * payload) pair over the transport and surface the identical decoded value.
 * The row-level codec pins live in
 * src/messaging/__tests__/sqliteMaintainWireTable.test.ts; these tests prove
 * the gateway actually routes through them.
 */
import { describe, it, expect } from 'vitest';
import { SqliteClient } from '../sqlite/offscreenGateway.js';
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

describe('background/sqliteMaintainWireDispatch: table-driven maintain routing', () => {
  it('init/healthCheck send their health messages with {} and decode success to true', async () => {
    const transport = recordingTransport({ success: true } as OffscreenResponse);
    const client = new SqliteClient(transport);

    expect(await client.maintain({ type: 'init' })).toEqual({ success: true, data: true });
    expect(await client.maintain({ type: 'healthCheck' })).toEqual({ success: true, data: true });
    expect(transport.calls).toEqual([
      { type: 'SQLITE_INIT', payload: {} },
      { type: 'SQLITE_HEALTH_CHECK', payload: {} },
    ]);
  });

  it('backup sends SQLITE_BACKUP with {} and decodes number[] to Uint8Array', async () => {
    const transport = recordingTransport({ success: true, data: [1, 2, 3] } as OffscreenResponse);
    const client = new SqliteClient(transport);

    const result = await client.maintain({ type: 'backup' });
    expect(result).toEqual({ success: true, data: new Uint8Array([1, 2, 3]) });
    expect(transport.calls).toEqual([{ type: 'SQLITE_BACKUP', payload: {} }]);
  });

  it('restore sends SQLITE_RESTORE with bytes as number[] and decodes to undefined', async () => {
    const transport = recordingTransport({ success: true } as OffscreenResponse);
    const client = new SqliteClient(transport);

    expect(await client.maintain({ type: 'restore', data: new Uint8Array([4, 5]) })).toEqual({
      success: true,
      data: undefined,
    });
    expect(transport.calls).toEqual([{ type: 'SQLITE_RESTORE', payload: { data: [4, 5] } }]);
  });

  it('clearAll sends SQLITE_CLEAR_ALL with {} and decodes to undefined', async () => {
    const transport = recordingTransport({ success: true } as OffscreenResponse);
    const client = new SqliteClient(transport);

    expect(await client.maintain({ type: 'clearAll' })).toEqual({ success: true, data: undefined });
    expect(transport.calls).toEqual([{ type: 'SQLITE_CLEAR_ALL', payload: {} }]);
  });

  it('purgeOldRecords/purgeContent keep the SQLITE_PURGE vs CONTENT_PURGE split with literal payload keys', async () => {
    const transport = recordingTransport({ success: true, purged: 9 } as OffscreenResponse);
    const client = new SqliteClient(transport);

    expect(await client.maintain({ type: 'purgeOldRecords', retentionDays: 30 })).toEqual({
      success: true,
      data: { purged: 9 },
    });
    expect(await client.maintain({ type: 'purgeContent', retentionDays: 7, includeStarred: true })).toEqual({
      success: true,
      data: { purged: 9 },
    });
    expect(transport.calls[0]?.type).toBe('SQLITE_PURGE');
    expect(transport.calls[0]?.payload).toStrictEqual({ retentionDays: 30, maxRecords: undefined });
    expect(transport.calls[1]?.type).toBe('CONTENT_PURGE');
    expect(transport.calls[1]?.payload).toStrictEqual({
      retentionDays: 7,
      maxRecords: undefined,
      includeStarred: true,
    });
  });

  it('an unknown non-archive maintain type fails closed instead of misrouting', async () => {
    const transport = recordingTransport({ success: true } as OffscreenResponse);
    const client = new SqliteClient(transport);

    await expect(client.maintain({ type: 'nope' } as never)).rejects.toThrow('Unhandled maintain op');
    expect(transport.calls).toEqual([]);
  });
});
