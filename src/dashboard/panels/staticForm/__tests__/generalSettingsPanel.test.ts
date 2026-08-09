// @vitest-environment jsdom
/**
 * generalSettingsPanel.test.ts
 * PBI 2026-08-09-24: panel 層から dashboard.ts への逆依存解消
 *
 * このパネル(205行)はテストが1件も無かった。
 *
 * 逆依存の実害は「テストが書けない」ことではない（vitest.setup が chrome を
 * モックするので、dashboard.ts を読み込んでも initDashboard() は完走する）。
 * 実害は設計側にある: パネルを読むのに 842行の旧モジュールを併読する必要が
 * あり、かつ entrypoints/options/main.ts が dashboard.ts を main.ts より先に
 * import するという順序に暗黙的に依存している。
 *
 * そのため逆依存そのものをソース上で検証する。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createGeneralSettingsPanel } from '../generalSettingsPanel.js';

const panelSource = readFileSync(
  resolve(process.cwd(), 'src/dashboard/panels/staticForm/generalSettingsPanel.ts'),
  'utf-8',
);

beforeEach(() => {
  document.body.innerHTML = '<div id="panel-general"></div>';
});

describe('generalSettingsPanel — self-contained', () => {
  it('does not import from the god module it was meant to replace', () => {
    // The panel layer exists to decompose dashboard.ts; importing back from it
    // inverts that. main.ts -> panels/ -> dashboard.ts was the actual graph.
    expect(panelSource).not.toMatch(/from\s+['"][^'"]*\/dashboard\.js['"]/);
  });

  it('declares the id and category the registry navigates by', () => {
    const panel = createGeneralSettingsPanel();
    expect(panel.id).toBe('panel-general');
    expect(panel.category).toBe('static-form');
  });

  it('mounts without throwing', async () => {
    const panel = createGeneralSettingsPanel();
    const container = document.getElementById('panel-general')!;

    await expect(panel.mount(container)).resolves.not.toThrow();
  });

  it('exposes refresh so the panel can re-read persisted settings', async () => {
    const panel = createGeneralSettingsPanel();
    await panel.mount(document.getElementById('panel-general')!);

    await expect(panel.refresh?.()).resolves.not.toThrow();
  });
});
