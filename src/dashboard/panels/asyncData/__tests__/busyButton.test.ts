// @vitest-environment jsdom
/**
 * busyButton.test.ts — unit tests for the shared busy-button seam
 * (PBI 2026-10-23-07). Pins the button lifecycle for the success and
 * rejection paths, with and without `restoreOnSuccess`, without real-time
 * waits: the run callback is held open with Promise.withResolvers and
 * settled by the test.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { withBusyButton } from '../busyButton.js';

function makeButton(label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = label;
  document.body.appendChild(button);
  return button;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('busyButton', () => {
  describe('withBusyButton', () => {
    it('shows the busy state while run is pending and restores it on success', async () => {
      const button = makeButton('Run');
      const gate = Promise.withResolvers<string>();
      const pending = withBusyButton(button, () => gate.promise);

      expect(button.disabled).toBe(true);
      expect(button.textContent).not.toBe('Run');

      gate.resolve('done');
      await expect(pending).resolves.toBe('done');
      expect(button.disabled).toBe(false);
      expect(button.textContent).toBe('Run');
    });

    it('restores the button and rethrows the error when run rejects', async () => {
      const button = makeButton('Run');
      const gate = Promise.withResolvers<string>();
      const pending = withBusyButton(button, () => gate.promise);
      expect(button.disabled).toBe(true);

      gate.reject(new Error('boom'));
      await expect(pending).rejects.toThrow('boom');
      expect(button.disabled).toBe(false);
      expect(button.textContent).toBe('Run');
    });

    it('keeps the busy state on success when restoreOnSuccess is false', async () => {
      const button = makeButton('Save');
      await withBusyButton(button, async () => 'ok', { restoreOnSuccess: false });

      expect(button.disabled).toBe(true);
      expect(button.textContent).not.toBe('Save');
    });

    it('restores the button on rejection even when restoreOnSuccess is false', async () => {
      const button = makeButton('Save');
      const gate = Promise.withResolvers<string>();
      const pending = withBusyButton(button, () => gate.promise, { restoreOnSuccess: false });

      gate.reject(new Error('boom'));
      await expect(pending).rejects.toThrow('boom');
      expect(button.disabled).toBe(false);
      expect(button.textContent).toBe('Save');
    });
  });
});
