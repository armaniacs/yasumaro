/**
 * statusMessageCssContract.test.ts
 *
 * The status class contract is shared between a stylesheet and a helper:
 * showStatus (src/utils/ui/settingsUiHelper.ts) writes `status-message <type>`
 * and clears back to `status-message`, so dashboard.css has to keep the base
 * class meaningful on its own. jsdom does not resolve stylesheets, so a change
 * that drops the base-class metrics or the reveal rule for a migrated surface
 * is invisible to every other test here — this one reads the CSS instead.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'entrypoints', 'options', 'dashboard.css'),
  'utf-8'
);

/** selector list -> declaration bodies, comments removed. */
function rules(): Map<string, string[]> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = new Map<string, string[]>();
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const key = match[1].split(',').map((s) => s.trim()).filter(Boolean).join(', ');
    const body = match[2].replace(/\s+/g, ' ').trim();
    found.set(key, [...(found.get(key) ?? []), body]);
  }
  return found;
}

const all = rules();

function bodyOf(...selectors: string[]): string {
  for (const [key, bodies] of all) {
    const parts = key.split(', ');
    if (selectors.every((s) => parts.includes(s))) return bodies.join('; ');
  }
  return '';
}

describe('status message class contract', () => {
  it('keeps the box metrics on the base class alone', () => {
    const base = bodyOf('.status-message');
    expect(base).toContain('margin-top: 12px');
    expect(base).toContain('min-height: 20px');
    expect(bodyOf('.status-message', '.success', '.error')).toContain('padding: 10px 12px');
  });

  it('restates the per-element spacing the markup declared, keyed by id so the class write cannot drop it', () => {
    const eightPx = bodyOf('#localExportManualStatus', '#reviewSummaryStatus', '#exportLocalMarkdownStatus');
    expect(eightPx).toContain('margin-top: var(--space-2, 8px)');
    expect(bodyOf('#trancoUpdateStatus')).toContain('margin-top: var(--space-4)');
    // The base value stays the 12px every other status element relies on, so
    // the id rules are the only per-element override.
    expect(bodyOf('.status-message')).toContain('margin-top: 12px');
  });

  it('gives the bare and prefixed success spellings one declaration set', () => {
    const body = bodyOf('.status-message.success', '.success');
    expect(body).toContain('color: var(--color-success-text)');
    expect(body).toContain('background: var(--color-success-bg)');
    expect(body).toContain('border: 1px solid var(--color-success-border)');
  });

  it('gives the bare and prefixed error spellings one declaration set', () => {
    const body = bodyOf('.status-message.error', '.error');
    expect(body).toContain('color: var(--color-danger-text)');
    expect(body).toContain('background: var(--color-danger-bg)');
    expect(body).toContain('border: 1px solid var(--color-danger-border)');
  });

  it('gates the toast animation on the extra .show class so it cannot double-apply', () => {
    expect(bodyOf('.status-message')).toContain('transition: opacity');
    expect(bodyOf('.status-message.show')).toContain('animation: ym-toast-in');
    // showStatus never writes `show`, so a status render only ever transitions.
    const helper = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'settingsUiHelper.ts'),
      'utf-8'
    );
    expect(helper).not.toContain("'show'");
  });

  it('reveals the csp save messages by type class, since the helper writes no inline display', () => {
    const reveal = bodyOf('.csp-save-area .success-message.success', '.csp-save-area .success-message.error');
    expect(reveal).toContain('display: block');
    expect(bodyOf('.success-message:empty')).toContain('display: none');
  });

  it('restates the models-dev dialog error box, whose own class the helper replaces', () => {
    const box = bodyOf('#models-dev-dialog .status-message');
    expect(box).toContain('padding: 12px 20px');
    expect(box).toContain('margin-top: 0');
    expect(bodyOf('#models-dev-dialog .status-message:empty')).toContain('display: none');
  });
});
