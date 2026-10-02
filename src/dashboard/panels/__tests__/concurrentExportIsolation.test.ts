// @vitest-environment jsdom
/**
 * concurrentExportIsolation.test.ts
 * PBI 2026-10-02-06: proves the intended concurrency shape of runPanelAction
 * (panelAction.ts:76 disables `buttons`, :88 restores them) without touching
 * production code. Export flows pass disjoint single-button scopes
 * (exportLogsPanel.ts:23-71); archive flows pass the shared group `controls`
 * (archivePanel.ts:56). panelAction.ts itself is referenced read-only.
 */
import { describe, it, expect, vi } from 'vitest';
import { runPanelAction, unwrapServiceResult } from '../panelAction.js';
import { waitForMock } from '../../../../testDir/waitPolicy.js';

function makeButton(label = 'Go'): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = label;
  return button;
}

describe('concurrentExportIsolation', () => {
  describe('runPanelAction', () => {
    it('attributes each concurrent result to its own input without crossover', async () => {
      const jsonBtn = makeButton('JSON');
      const mdBtn = makeButton('MD');
      const jsonGate = Promise.withResolvers<string>();
      const mdGate = Promise.withResolvers<string>();
      const jsonSuccess = vi.fn();
      const mdSuccess = vi.fn();

      const jsonAction = runPanelAction({
        buttons: [jsonBtn],
        run: () => jsonGate.promise,
        onSuccess: jsonSuccess,
      });
      const mdAction = runPanelAction({
        buttons: [mdBtn],
        run: () => mdGate.promise,
        onSuccess: mdSuccess,
      });

      await waitForMock(() => {
        expect(jsonBtn.disabled).toBe(true);
        expect(mdBtn.disabled).toBe(true);
      });

      // Resolve in reverse order: attribution must follow the closure, not timing.
      mdGate.resolve('markdown-payload');
      await mdAction;
      expect(mdSuccess).toHaveBeenCalledWith('markdown-payload');
      expect(jsonSuccess).not.toHaveBeenCalled();
      expect(mdBtn.disabled).toBe(false);
      expect(jsonBtn.disabled).toBe(true);

      jsonGate.resolve('json-payload');
      await jsonAction;
      expect(jsonSuccess).toHaveBeenCalledWith('json-payload');
      expect(jsonBtn.disabled).toBe(false);
    });

    it('restores sibling controls independently when single-button actions overlap', async () => {
      const csvBtn = makeButton('CSV');
      const dbBtn = makeButton('DB');
      const csvGate = Promise.withResolvers<number>();
      const dbGate = Promise.withResolvers<number>();

      const csvAction = runPanelAction({ buttons: [csvBtn], run: () => csvGate.promise });
      const dbAction = runPanelAction({ buttons: [dbBtn], run: () => dbGate.promise });

      await waitForMock(() => {
        expect(csvBtn.disabled).toBe(true);
        expect(dbBtn.disabled).toBe(true);
      });

      csvGate.resolve(1);
      await csvAction;
      expect(csvBtn.disabled).toBe(false);
      // The still-pending sibling keeps its own scope disabled (isolation,
      // not a shared lock released early by the first finisher).
      expect(dbBtn.disabled).toBe(true);

      dbGate.resolve(2);
      await dbAction;
      expect(dbBtn.disabled).toBe(false);
    });

    it('disables the whole archive group for the duration and restores it afterwards', async () => {
      const previewBtn = makeButton('Preview');
      const createBtn = makeButton('Create');
      const cleanupBtn = makeButton('Cleanup');
      const group = [previewBtn, createBtn, cleanupBtn] as const;
      const gate = Promise.withResolvers<string>();
      const states: boolean[] = [];
      const onBusy = vi.fn((busy: boolean) => states.push(busy));

      const action = runPanelAction({
        buttons: [...group],
        onBusy,
        run: () => gate.promise,
      });

      await waitForMock(() => {
        expect(previewBtn.disabled).toBe(true);
        expect(createBtn.disabled).toBe(true);
        expect(cleanupBtn.disabled).toBe(true);
      });

      gate.resolve('preview-data');
      await action;

      expect(previewBtn.disabled).toBe(false);
      expect(createBtn.disabled).toBe(false);
      expect(cleanupBtn.disabled).toBe(false);
      expect(onBusy).toHaveBeenNthCalledWith(1, true);
      expect(onBusy).toHaveBeenLastCalledWith(false);
    });

    it('routes concurrent service and thrown failures to their own handlers only', async () => {
      const okBtn = makeButton('OK');
      const failBtn = makeButton('Fail');
      const okGate = Promise.withResolvers<{ data: string }>();
      const failGate = Promise.withResolvers<{ error: string }>();
      const okSuccess = vi.fn();
      const okError = vi.fn();
      const failSuccess = vi.fn();
      const failError = vi.fn();

      const okAction = runPanelAction({
        buttons: [okBtn],
        run: async () => unwrapServiceResult(await okGate.promise),
        onSuccess: okSuccess,
        onError: okError,
      });
      const failAction = runPanelAction({
        buttons: [failBtn],
        run: async () => unwrapServiceResult(await failGate.promise),
        onSuccess: failSuccess,
        onError: failError,
      });

      await waitForMock(() => {
        expect(okBtn.disabled).toBe(true);
        expect(failBtn.disabled).toBe(true);
      });

      failGate.resolve({ error: 'db locked' });
      await failAction;
      expect(failError).toHaveBeenCalledWith('db locked', 'service', 'db locked');
      expect(failSuccess).not.toHaveBeenCalled();
      expect(failBtn.disabled).toBe(false);
      expect(okBtn.disabled).toBe(true);

      okGate.resolve({ data: 'export-ok' });
      await okAction;
      expect(okSuccess).toHaveBeenCalledWith('export-ok');
      expect(okError).not.toHaveBeenCalled();
      expect(okBtn.disabled).toBe(false);
    });

    it('keeps a thrown rejection isolated from a concurrent success', async () => {
      const aBtn = makeButton('A');
      const bBtn = makeButton('B');
      const aGate = Promise.withResolvers<string>();
      const bGate = Promise.withResolvers<string>();
      const aError = vi.fn();
      const bSuccess = vi.fn();

      const aAction = runPanelAction({
        buttons: [aBtn],
        run: async () => {
          await aGate.promise;
          throw new Error('gateway down');
        },
        onError: aError,
      });
      const bAction = runPanelAction({
        buttons: [bBtn],
        run: () => bGate.promise,
        onSuccess: bSuccess,
      });

      await waitForMock(() => {
        expect(aBtn.disabled).toBe(true);
        expect(bBtn.disabled).toBe(true);
      });

      bGate.resolve('b-data');
      await bAction;
      expect(bSuccess).toHaveBeenCalledWith('b-data');
      expect(bBtn.disabled).toBe(false);
      expect(aBtn.disabled).toBe(true);

      aGate.resolve('release');
      await aAction;
      expect(aError).toHaveBeenCalledWith('gateway down', 'thrown', expect.any(Error));
      expect(aBtn.disabled).toBe(false);
    });
  });
});
