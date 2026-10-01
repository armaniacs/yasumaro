/**
 * gatewayExecuteSeam.test.ts — PBI 2026-10-01-04.
 *
 * BDD: execute(op) routes every QueryOp / MutateOp / MaintainOp through the
 * same wire-table row + callInternal seam as the dedicated method — same
 * transport call, same result. The retry policy application stays at the
 * single transport seam: execute passes no caller-side retry override, so the
 * neutral policy table (via the transport's own lookup) is the only decision
 * point.
 */
import { describe, it, expect, vi } from 'vitest';
import { OffscreenGateway } from '../sqlite/offscreenGateway.js';
import type { OffscreenTransport, MsgOffscreenOptions } from '../offscreenTransport.js';
import type { OffscreenResponse, SqliteMessageType } from '../../messaging/sqliteMessages.js';

type TransportCall = {
  type: SqliteMessageType;
  payload: Record<string, unknown>;
  traceId: string;
  opts: MsgOffscreenOptions | undefined;
};

function createRecordingTransport(response: OffscreenResponse): {
  transport: OffscreenTransport;
  calls: TransportCall[];
} {
  const calls: TransportCall[] = [];
  const transport: OffscreenTransport = {
    async msgOffscreen(type, payload = {}, traceId = '', opts): Promise<OffscreenResponse> {
      calls.push({ type, payload, traceId, opts });
      return response;
    },
  };
  return { transport, calls };
}

describe('gateway execute seam (PBI 2026-10-01-04)', () => {
  it('execute(query op) reaches the same transport call as query()', async () => {
    const response = { success: true, rows: [{ id: 1 }], total: 1 } as OffscreenResponse;
    const viaQuery = createRecordingTransport(response);
    const viaExecute = createRecordingTransport(response);
    const op = { kind: 'search', text: 'kw', limit: 5 } as const;

    const gatewayA = new OffscreenGateway(viaQuery.transport);
    const gatewayB = new OffscreenGateway(viaExecute.transport);

    const [a, b] = await Promise.all([gatewayA.query(op), gatewayB.execute(op)]);

    expect(b).toEqual(a);
    expect(viaExecute.calls).toEqual(viaQuery.calls);
    // The search row folds into SQLITE_QUERY (the QueryOp is rebuilt as a
    // StorageQuery with text); SQLITE_SEARCH is only reachable by direct
    // offscreen messages.
    expect(viaExecute.calls[0].type).toBe('SQLITE_QUERY');
  });

  it('execute(mutate op) reaches the same transport call as mutate()', async () => {
    const response = { success: true, id: 42 } as OffscreenResponse;
    const viaMutate = createRecordingTransport(response);
    const viaExecute = createRecordingTransport(response);
    const op = { type: 'insert', record: { url: 'https://example.com', title: 'T', created_at: 1 } } as const;

    const gatewayA = new OffscreenGateway(viaMutate.transport);
    const gatewayB = new OffscreenGateway(viaExecute.transport);

    const [a, b] = await Promise.all([gatewayA.mutate(op), gatewayB.execute(op)]);

    expect(b).toEqual(a);
    expect(viaExecute.calls).toEqual(viaMutate.calls);
    expect(viaExecute.calls[0].type).toBe('SQLITE_INSERT');
  });

  it('execute(maintain op) reaches the same transport call as maintain()', async () => {
    const response = { success: true, removed: ['staging.db'] } as OffscreenResponse;
    const viaMaintain = createRecordingTransport(response);
    const viaExecute = createRecordingTransport(response);
    const op = { type: 'archiveCleanup' } as const;

    const gatewayA = new OffscreenGateway(viaMaintain.transport);
    const gatewayB = new OffscreenGateway(viaExecute.transport);

    const [a, b] = await Promise.all([gatewayA.maintain(op), gatewayB.execute(op)]);

    expect(b).toEqual(a);
    expect(viaExecute.calls).toEqual(viaMaintain.calls);
    expect(viaExecute.calls[0].type).toBe('SQLITE_ARCHIVE_CLEANUP');
  });

  it('execute(plain StorageQuery) folds into the records op like query()', async () => {
    const response = { success: true, rows: [], total: 0 } as OffscreenResponse;
    const viaQuery = createRecordingTransport(response);
    const viaExecute = createRecordingTransport(response);

    const gatewayA = new OffscreenGateway(viaQuery.transport);
    const gatewayB = new OffscreenGateway(viaExecute.transport);

    await Promise.all([gatewayA.query({ limit: 3 }), gatewayB.execute({ kind: 'records', q: { limit: 3 } })]);

    expect(viaExecute.calls).toEqual(viaQuery.calls);
    expect(viaExecute.calls[0].type).toBe('SQLITE_QUERY');
  });

  it('leaves the retry policy to the transport table for a row-owned unsafe op', async () => {
    // archiveCreate owns RETRY_UNSAFE (a lost response may follow a committed
    // write). execute must NOT add a caller-side retry override — the neutral
    // policy table, applied at the single transport seam, is the only
    // decision point.
    const { transport, calls } = createRecordingTransport({ success: true, stagingName: 's' } as OffscreenResponse);
    const gateway = new OffscreenGateway(transport);

    await gateway.execute({ type: 'archiveCreate', cutoffDate: '2026-09-01', cutoffMs: 0, includeDeleted: false, yasumaroVersion: 'test' });

    expect(calls).toHaveLength(1);
    expect(calls[0].opts).toBeUndefined();
  });

  it('routes an unknown maintain op to a closed failure (drifted lookup)', async () => {
    const { transport, calls } = createRecordingTransport({ success: true } as OffscreenResponse);
    const gateway = new OffscreenGateway(transport);

    await expect(
      gateway.execute({ type: 'bogus_op' } as Parameters<OffscreenGateway['execute']>[0]),
    ).rejects.toThrow('Unhandled maintain op');
    expect(calls).toHaveLength(0);
  });
});
