/**
 * localMarkdownExportTimingUi.test.ts
 * Radio-group read/write helpers for LOCAL_MARKDOWN_EXPORT_TIMING.
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { extractLocalMarkdownExportTiming, loadLocalMarkdownExportTiming, resetDashboardElements } from '../dashboard.js';

function renderRadios(): void {
  document.body.innerHTML = `
    <input type="radio" name="localMarkdownExportTiming" id="r1" value="manual">
    <input type="radio" name="localMarkdownExportTiming" id="r2" value="immediate">
    <input type="radio" name="localMarkdownExportTiming" id="r3" value="idle">
    <input type="radio" name="localMarkdownExportTiming" id="r4" value="daily">
  `;
  resetDashboardElements();
}

describe('LOCAL_MARKDOWN_EXPORT_TIMING radio group', () => {
  beforeEach(() => {
    renderRadios();
  });

  it('extractLocalMarkdownExportTiming returns the checked radio value', () => {
    (document.getElementById('r3') as HTMLInputElement).checked = true;
    expect(extractLocalMarkdownExportTiming()).toBe('idle');
  });

  it('extractLocalMarkdownExportTiming returns undefined when nothing is checked', () => {
    expect(extractLocalMarkdownExportTiming()).toBeUndefined();
  });

  it('loadLocalMarkdownExportTiming checks the matching radio', () => {
    loadLocalMarkdownExportTiming('daily');
    expect((document.getElementById('r4') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('r1') as HTMLInputElement).checked).toBe(false);
  });

  it('loadLocalMarkdownExportTiming checks nothing when value is undefined', () => {
    loadLocalMarkdownExportTiming(undefined);
    for (const id of ['r1', 'r2', 'r3', 'r4']) {
      expect((document.getElementById(id) as HTMLInputElement).checked).toBe(false);
    }
  });
});
