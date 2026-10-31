// @vitest-environment jsdom
/**
 * selectionCapture.test.ts (PBI 2026-10-31-03)
 * handleGetSelectionMessage is chrome-free: no chrome global is stubbed in
 * this file, proving the handler is directly callable without module
 * re-imports. The selection reader is injected — the handler never touches
 * window.getSelection() itself, so the jsdom environment is incidental.
 */
import { describe, it, expect, vi } from 'vitest';
import { handleGetSelectionMessage, type SelectionCaptureDeps } from '../selectionCapture.js';

function makeDeps(
  readSelection: () => string = () => 'selected paragraph',
  runtimeId: string | undefined = 'test-extension-id',
): { deps: SelectionCaptureDeps; readSelection: () => string } {
  return { deps: { runtimeId, readSelection }, readSelection };
}

describe('handleGetSelectionMessage - chrome-free direct calls', () => {
  it('answers same-extension GET_SELECTION with the captured selection', () => {
    const { deps } = makeDeps(() => 'selected paragraph');
    const sendResponse = vi.fn();

    handleGetSelectionMessage({ type: 'GET_SELECTION' }, { id: 'test-extension-id' }, sendResponse, deps);

    expect(sendResponse).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({ selection: 'selected paragraph' });
  });

  it('answers with an empty string when nothing is selected', () => {
    const { deps } = makeDeps(() => '');
    const sendResponse = vi.fn();

    handleGetSelectionMessage({ type: 'GET_SELECTION' }, { id: 'test-extension-id' }, sendResponse, deps);

    expect(sendResponse).toHaveBeenCalledWith({ selection: '' });
  });

  it('does not read the selection for other message types', () => {
    const { deps, readSelection } = makeDeps();
    const spy = vi.fn(readSelection);
    const guarded: SelectionCaptureDeps = { ...deps, readSelection: spy };
    const sendResponse = vi.fn();

    const result = handleGetSelectionMessage(
      { type: 'GET_CONTENT' },
      { id: 'test-extension-id' },
      sendResponse,
      guarded,
    );

    expect(sendResponse).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('ignores non-object / null / type-less messages', () => {
    const { deps, readSelection } = makeDeps();
    const spy = vi.fn(readSelection);
    const guarded: SelectionCaptureDeps = { ...deps, readSelection: spy };
    for (const message of [undefined, null, 42, 'GET_SELECTION', {}, { type: 7 }]) {
      const sendResponse = vi.fn();
      handleGetSelectionMessage(message, { id: 'test-extension-id' }, sendResponse, guarded);
      expect(sendResponse).not.toHaveBeenCalled();
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects senders whose id differs from runtimeId', () => {
    const { deps, readSelection } = makeDeps();
    const spy = vi.fn(readSelection);
    const guarded: SelectionCaptureDeps = { ...deps, readSelection: spy };
    const sendResponse = vi.fn();

    handleGetSelectionMessage({ type: 'GET_SELECTION' }, { id: 'external-id' }, sendResponse, guarded);

    expect(sendResponse).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns undefined (no value) — a sync handler, response goes through sendResponse only', () => {
    const { deps } = makeDeps();
    expect(handleGetSelectionMessage({ type: 'GET_SELECTION' }, { id: 'test-extension-id' }, vi.fn(), deps)).toBeUndefined();
  });
});
