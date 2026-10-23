// @vitest-environment jsdom
/**
 * proposalRowWiring.test.ts
 * Unit tests for the shared proposal row seam (PBI 2026-10-23-08):
 * apply/undo transitions, failure restore, and the applied-count
 * failure detail absorbed through the formatter argument.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitForMock } from '../../../testDir/waitPolicy.js';
import { wireProposalRow } from '../proposalRowWiring.js';
import type { ProposalRowActions } from '../proposalRowWiring.js';
import { TagRenameError } from '../tagRenameApplier.js';

const SELECTORS = {
  apply: '[data-test-apply]',
  undo: '[data-test-undo]',
  status: '.test-status',
};

interface WiredRow {
  row: HTMLElement;
  applyButton: HTMLButtonElement;
  undoButton: HTMLButtonElement;
  status: HTMLElement;
}

function buildRow(): WiredRow {
  const row = document.createElement('div');
  row.innerHTML =
    '<button type="button" data-test-apply>Apply</button>' +
    '<button type="button" data-test-undo hidden>Undo</button>' +
    '<div class="test-status" role="status"></div>';
  document.body.appendChild(row);
  return {
    row,
    applyButton: row.querySelector<HTMLButtonElement>('[data-test-apply]')!,
    undoButton: row.querySelector<HTMLButtonElement>('[data-test-undo]')!,
    status: row.querySelector<HTMLElement>('.test-status')!,
  };
}

function wireWith(actions: ProposalRowActions): WiredRow {
  const wired = buildRow();
  wireProposalRow(wired.row, SELECTORS, actions);
  return wired;
}

describe('proposalRowWiring', () => {
  describe('wireProposalRow', () => {
    beforeEach(() => {
      document.body.innerHTML = '';
    });

    it('applies then undoes with the same button transitions', async () => {
      const actions: ProposalRowActions = {
        apply: vi.fn().mockResolvedValue('applied message'),
        undo: vi.fn().mockResolvedValue('undone message'),
      };
      const { applyButton, undoButton, status } = wireWith(actions);

      applyButton.click();
      await waitForMock(() => expect(status.textContent).toBe('applied message'));

      expect(actions.apply).toHaveBeenCalledTimes(1);
      expect(applyButton.disabled).toBe(true);
      expect(undoButton.hidden).toBe(false);

      undoButton.click();
      await waitForMock(() => expect(status.textContent).toBe('undone message'));

      expect(actions.undo).toHaveBeenCalledTimes(1);
      expect(undoButton.hidden).toBe(true);
      expect(applyButton.disabled).toBe(false);
    });

    it('pins two apply-undo rounds with enabled undo each time', async () => {
      const actions: ProposalRowActions = {
        apply: vi
          .fn()
          .mockResolvedValueOnce('applied one')
          .mockResolvedValueOnce('applied two'),
        undo: vi
          .fn()
          .mockResolvedValueOnce('undone one')
          .mockResolvedValueOnce('undone two'),
      };
      const { applyButton, undoButton, status } = wireWith(actions);

      applyButton.click();
      await waitForMock(() => expect(status.textContent).toBe('applied one'));
      expect(applyButton.disabled).toBe(true);
      expect(undoButton.hidden).toBe(false);
      expect(undoButton.disabled).toBe(false);

      undoButton.click();
      await waitForMock(() => expect(status.textContent).toBe('undone one'));
      expect(undoButton.hidden).toBe(true);
      expect(undoButton.disabled).toBe(false);
      expect(applyButton.disabled).toBe(false);

      applyButton.click();
      await waitForMock(() => expect(status.textContent).toBe('applied two'));
      expect(applyButton.disabled).toBe(true);
      expect(undoButton.hidden).toBe(false);
      expect(undoButton.disabled).toBe(false);

      undoButton.click();
      await waitForMock(() => expect(status.textContent).toBe('undone two'));
      expect(actions.apply).toHaveBeenCalledTimes(2);
      expect(actions.undo).toHaveBeenCalledTimes(2);
      expect(undoButton.hidden).toBe(true);
      expect(undoButton.disabled).toBe(false);
      expect(applyButton.disabled).toBe(false);
    });

    it('drops re-entrant clicks while a run is in flight', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const actions: ProposalRowActions = {
        apply: vi.fn().mockReturnValue(gate.then(() => 'applied message')),
        undo: vi.fn().mockResolvedValue('undone message'),
      };
      const { applyButton, status } = wireWith(actions);

      applyButton.click();
      applyButton.click();
      release();
      await waitForMock(() => expect(status.textContent).toBe('applied message'));

      expect(actions.apply).toHaveBeenCalledTimes(1);
    });

    it('restores the apply button and shows the error when apply fails', async () => {
      const actions: ProposalRowActions = {
        apply: vi.fn().mockRejectedValue(new Error('apply failed')),
        undo: vi.fn().mockResolvedValue('undone message'),
      };
      const { applyButton, undoButton, status } = wireWith(actions);

      applyButton.click();
      await waitForMock(() => expect(status.textContent).toBe('apply failed'));

      expect(applyButton.disabled).toBe(false);
      expect(undoButton.hidden).toBe(true);
      expect(actions.undo).not.toHaveBeenCalled();
    });

    it('restores the undo button and keeps apply disabled when undo fails', async () => {
      const actions: ProposalRowActions = {
        apply: vi.fn().mockResolvedValue('applied message'),
        undo: vi.fn().mockRejectedValue(new Error('undo failed')),
      };
      const { applyButton, undoButton, status } = wireWith(actions);

      applyButton.click();
      await waitForMock(() => expect(status.textContent).toBe('applied message'));

      undoButton.click();
      await waitForMock(() => expect(status.textContent).toBe('undo failed'));

      expect(undoButton.disabled).toBe(false);
      expect(undoButton.hidden).toBe(false);
      expect(applyButton.disabled).toBe(true);
    });

    it('renders the applied count through the failure formatter', async () => {
      const actions: ProposalRowActions = {
        apply: vi.fn().mockRejectedValue(new TagRenameError('write failed', 2)),
        undo: vi.fn().mockResolvedValue('undone message'),
      };
      const wired = buildRow();
      wireProposalRow(wired.row, SELECTORS, actions, {
        formatApplyError: (error) => {
          const updated = error instanceof TagRenameError ? error.updated : 0;
          return `${error.message} (${updated} applied)`;
        },
      });

      wired.applyButton.click();
      await waitForMock(() => expect(wired.status.textContent).toBe('write failed (2 applied)'));

      expect(wired.applyButton.disabled).toBe(false);
      expect(wired.undoButton.hidden).toBe(true);
    });

    it('falls back to the error message for non-Error rejections', async () => {
      const formatApplyError = vi.fn().mockReturnValue('formatted');
      const actions: ProposalRowActions = {
        apply: vi.fn().mockRejectedValue('plain failure'),
        undo: vi.fn().mockResolvedValue('undone message'),
      };
      const wired = buildRow();
      wireProposalRow(wired.row, SELECTORS, actions, { formatApplyError });

      wired.applyButton.click();
      await waitForMock(() => expect(wired.status.textContent).toBe('plain failure'));

      expect(formatApplyError).not.toHaveBeenCalled();
      expect(wired.applyButton.disabled).toBe(false);
    });

    it('tolerates a row without buttons or a status line', () => {
      const actions: ProposalRowActions = {
        apply: vi.fn().mockResolvedValue('applied message'),
        undo: vi.fn().mockResolvedValue('undone message'),
      };
      const row = document.createElement('div');
      expect(() => wireProposalRow(row, SELECTORS, actions)).not.toThrow();
    });
  });
});
