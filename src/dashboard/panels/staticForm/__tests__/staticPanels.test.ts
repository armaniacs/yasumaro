// @vitest-environment jsdom
/**
 * staticPanels.test.ts
 * PBI 2026-08-09-22: 宣言表のidが実際のHTMLと対応していることを固定する
 *
 * jsdom が必要な理由: staticPanels.ts が import する init 関数群のうち
 * exportImport.ts -> masterPassword.ts などがモジュールレベルで
 * document.getElementById を呼んでいる（本PBI以前からの設計で、
 * 旧9ファイルにテストが無かったため今まで露見していなかった）。
 *
 * idのタイプミスは無言で失敗する: NavigationRegistry.navigate() は
 * throw するが、DashboardBootstrapper.wireSidebar がそれを catch して
 * いるため、該当タブだけが「押しても何も起きない」状態になる。
 * 対象9件は元々テストが1件も無かったので、ここで機械的に担保する。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { STATIC_FORM_PANELS } from '../staticPanels.js';

const html = readFileSync(
  resolve(process.cwd(), 'entrypoints/options/index.html'),
  'utf-8',
);

describe('STATIC_FORM_PANELS', () => {
  it('declares the expected number of panels', () => {
    expect(STATIC_FORM_PANELS).toHaveLength(9);
  });

  it('gives every panel an element in the options page', () => {
    for (const panel of STATIC_FORM_PANELS) {
      expect(html, `${panel.id} has no <div id>`).toContain(`id="${panel.id}"`);
    }
  });

  it('gives every panel a sidebar button that navigates to it', () => {
    for (const panel of STATIC_FORM_PANELS) {
      expect(html, `${panel.id} has no data-panel button`).toContain(`data-panel="${panel.id}"`);
    }
  });

  it('has no duplicate ids', () => {
    const ids = STATIC_FORM_PANELS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('registers every panel as static-form', () => {
    for (const panel of STATIC_FORM_PANELS) {
      expect(panel.category, panel.id).toBe('static-form');
    }
  });

  it('gives every panel a mount function', () => {
    for (const panel of STATIC_FORM_PANELS) {
      expect(typeof panel.mount, panel.id).toBe('function');
    }
  });

  it('declares refresh only on the four panels that re-read persisted values', () => {
    const withRefresh = STATIC_FORM_PANELS.filter(p => 'refresh' in p).map(p => p.id);
    expect(withRefresh.sort()).toEqual(
      ['panel-content', 'panel-csp', 'panel-domain', 'panel-trust'].sort(),
    );
  });
});
