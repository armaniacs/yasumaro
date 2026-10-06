/**
 * wireLambdaFactories.test.ts (PBI 2026-10-06-17)
 *
 * The shared factories replace dozens of inline single-element lambdas in
 * the wire tables. These tests pin the behavior each name promises
 * (intentionally empty vs forgotten stays readable at the use site) and
 * pin that the tables actually share the references.
 */
import { describe, it, expect } from 'vitest';
import {
  emptyArgs,
  emptyPayload,
  emptyProject,
  idArg,
  noValidate,
  stagingNameArg,
  trueDecode,
  voidDecode,
} from '../wireLambdaFactories.js';
import { SQLITE_WIRE_TABLE, SQLITE_MAINTAIN_WIRE_TABLE } from '../sqliteWireTable.js';
import { ARCHIVE_WIRE_TABLE } from '../archiveWireTable.js';

describe('messaging/wireLambdaFactories: behavior', () => {
  it('noValidate accepts everything', () => {
    expect(noValidate()).toBeNull();
  });

  it('empty factories return fresh values per call', () => {
    expect(emptyProject()).toEqual({});
    expect(emptyProject()).not.toBe(emptyProject());
    expect(emptyPayload()).toEqual({});
    expect(emptyPayload()).not.toBe(emptyPayload());
    expect(emptyArgs()).toEqual([]);
    expect(emptyArgs()).not.toBe(emptyArgs());
  });

  it('arg factories project the documented field', () => {
    expect(idArg({ id: 7 })).toEqual([7]);
    expect(stagingNameArg({ stagingName: 's' })).toEqual(['s']);
  });

  it('decoders return their documented values', () => {
    expect(voidDecode()).toBeUndefined();
    expect(trueDecode()).toBe(true);
  });
});

describe('messaging/wireLambdaFactories: shared references', () => {
  const dashboardOf = (byOp: Map<string, unknown>, op: string) => {
    const dashboard = (byOp.get(op) as { dashboard?: unknown } | undefined)?.dashboard;
    expect(dashboard).toBeDefined();
    return dashboard as { validate: unknown; depsArgs: unknown; projectDeps: unknown };
  };
  it('sqlite query/mutate rows share validate/idArg/emptyProject', () => {
    const byOp = new Map(SQLITE_WIRE_TABLE.map((e) => [e.op, e]));
    expect(dashboardOf(byOp, 'delete').validate).toBe(noValidate);
    expect(dashboardOf(byOp, 'toggleStar').validate).toBe(noValidate);
    expect(dashboardOf(byOp, 'delete').depsArgs).toBe(idArg);
    expect(dashboardOf(byOp, 'toggleStar').depsArgs).toBe(idArg);
    expect(dashboardOf(byOp, 'delete').projectDeps).toBe(emptyProject);
  });

  it('sqlite count/maintain rows share emptyPayload/voidDecode/trueDecode', () => {
    const byOp = new Map(SQLITE_WIRE_TABLE.map((e) => [e.op, e]));
    expect(byOp.get('count')?.encodePayload).toBe(emptyPayload);
    const maintain = new Map(SQLITE_MAINTAIN_WIRE_TABLE.map((e) => [e.op, e]));
    expect(maintain.get('init')?.encodePayload).toBe(emptyPayload);
    expect(maintain.get('init')?.decodeGateway).toBe(trueDecode);
    expect(maintain.get('healthCheck')?.decodeGateway).toBe(trueDecode);
    expect(maintain.get('restore')?.decodeGateway).toBe(voidDecode);
  });

  it('archive rows share noValidate/stagingNameArg/emptyArgs', () => {
    for (const entry of ARCHIVE_WIRE_TABLE) {
      if (entry.op === 'archivePreview' || entry.op === 'archiveCreate' || entry.op === 'archiveExport' || entry.op === 'archiveQuery' || entry.op === 'archiveUpdate') continue;
      expect(entry.validate).toBe(noValidate);
    }
    const byOp = new Map(ARCHIVE_WIRE_TABLE.map((e) => [e.op, e]));
    expect(byOp.get('archiveRestore')?.backendArgs).toBe(stagingNameArg);
    expect(byOp.get('archiveSave')?.backendArgs).toBe(stagingNameArg);
    expect(byOp.get('archiveCleanup')?.backendArgs).toBe(emptyArgs);
    expect(byOp.get('archiveStatus')?.backendArgs).toBe(emptyArgs);
    expect(byOp.get('archiveOpen')?.decodeResponse).toBe(voidDecode);
    expect(byOp.get('archiveOpen')?.project).toBe(emptyProject);
  });
});
