// @vitest-environment jsdom
/**
 * rowCapNotice: the one fetch-cap notice publisher, moved out of the SVG
 * cluster renderer (PBI 2026-10-20-17). One pin per behavior the panels rely
 * on: the shared `rowCap` notice scope key and the substitution expansion in
 * the registered element.
 */
import { describe, it, expect } from 'vitest';
import { showRowCapNotice } from '../rowCapNotice.js';
import { PanelNotices } from '../PanelNotices.js';

describe('rowCapNotice', () => {
  describe('showRowCapNotice', () => {
    it('publishes the capped fetch with its substitutions in the panel notice', () => {
      const element = document.createElement('div');
      element.hidden = true;
      document.body.appendChild(element);
      const notices = new PanelNotices();
      notices.register('rowCap', element);

      showRowCapNotice({
        notices,
        messageKey: 'wordClusterRowCapNotice',
        fallback: 'unused',
        shown: 10_000,
        total: 12_345,
        limit: 10_000,
      });

      expect(element.hidden).toBe(false);
      expect(element.textContent).toContain('12345');
      expect(element.textContent).toContain('10000');
    });

    it('is a no-op when no rowCap element is registered', () => {
      const notices = new PanelNotices();

      expect(() =>
        showRowCapNotice({
          notices,
          messageKey: 'wordClusterRowCapNotice',
          fallback: 'unused',
          limit: 10_000,
        }),
      ).not.toThrow();
    });
  });
});
