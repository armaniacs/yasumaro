// @vitest-environment jsdom
/**
 * panelCategoryFilter.test.ts (PBI 2026-10-31-08)
 * 分類 UI の可視性制御を固定する:
 * - 選んだ分類のパネルのみが表示される (BDD ハッピーパス)
 * - 未割り当てパネルは「その他」分類で辿り着ける (BDD 境界値)
 * - settings subgroup とセクション見出しの状態が規約どおりに動く
 * - 状態は DOM の hidden 属性のみ (storage キーは増やさない)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  applyPanelCategoryFilter,
  wirePanelCategoryFilter,
  PANEL_CATEGORY_FILTER_ALL,
} from '../panelCategoryFilter.js';

/** index.html と同じ形の sidebar fixture の型 (インデックスアクセスでの
 * undefined を避けるため名前付きプロパティで型付けする)。 */
interface CategoryFilterFixture {
  sidebar: HTMLElement;
  subgroup: HTMLElement;
  tabs: {
    general: HTMLButtonElement;
    domain: HTMLButtonElement;
    recording: HTMLButtonElement;
    tagCluster: HTMLButtonElement;
    diagnostics: HTMLButtonElement;
    exportLogs: HTMLButtonElement;
    reportBug: HTMLButtonElement;
  };
  labels: {
    settingsLabel: HTMLElement;
    dataLabel: HTMLElement;
    toolsLabel: HTMLElement;
  };
}

/** index.html と同じ形の sidebar fixture (セクション見出し + subgroup + 分割線)。 */
function buildSidebar(): CategoryFilterFixture {
  const sidebar = document.createElement('nav');
  const nav = document.createElement('div');
  nav.className = 'sidebar-nav';

  const makeButton = (panelId: string): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.className = 'sidebar-nav-btn';
    btn.setAttribute('data-panel', panelId);
    return btn;
  };

  const settingsLabel = document.createElement('div');
  settingsLabel.className = 'sidebar-section-label';
  const general = makeButton('panel-general');
  const subgroup = document.createElement('div');
  subgroup.className = 'sidebar-subgroup';
  subgroup.id = 'settingsSubgroup';
  const domain = makeButton('panel-domain');
  const recording = makeButton('panel-recording-conditions');
  subgroup.append(domain, recording);
  const divider1 = document.createElement('div');
  divider1.className = 'sidebar-divider';
  const dataLabel = document.createElement('div');
  dataLabel.className = 'sidebar-section-label';
  const tagCluster = makeButton('panel-tag-cluster');
  const diagnostics = makeButton('panel-diagnostics');
  const divider2 = document.createElement('div');
  divider2.className = 'sidebar-divider';
  const toolsLabel = document.createElement('div');
  toolsLabel.className = 'sidebar-section-label';
  const exportLogs = makeButton('panel-export-logs');
  // ナビゲーションタブでないアクションボタン (data-panel なし)。
  const reportBug = document.createElement('button');
  reportBug.className = 'sidebar-nav-btn';

  nav.append(settingsLabel, general, subgroup, divider1, dataLabel, tagCluster, diagnostics, divider2, toolsLabel, exportLogs, reportBug);
  sidebar.appendChild(nav);

  return {
    sidebar,
    tabs: { general, domain, recording, tagCluster, diagnostics, exportLogs, reportBug },
    subgroup,
    labels: { settingsLabel, dataLabel, toolsLabel },
  };
}

function visibleIds(sidebar: HTMLElement): string[] {
  return [...sidebar.querySelectorAll<HTMLElement>('.sidebar-nav-btn[data-panel]:not([hidden])')]
    .map((el) => el.getAttribute('data-panel') ?? '');
}

describe('applyPanelCategoryFilter', () => {
  let fixture: CategoryFilterFixture;

  beforeEach(() => {
    fixture = buildSidebar();
    document.body.appendChild(fixture.sidebar);
  });

  afterEach(() => {
    fixture.sidebar.remove();
  });

  it('shows only the selected category panels (BDD ハッピーパス)', () => {
    applyPanelCategoryFilter(fixture.sidebar, 'recording');
    expect(visibleIds(fixture.sidebar)).toEqual(['panel-domain', 'panel-recording-conditions']);
  });

  it('lands unassigned panels in other (BDD 境界値)', () => {
    applyPanelCategoryFilter(fixture.sidebar, 'other');
    expect(visibleIds(fixture.sidebar)).toEqual(['panel-diagnostics']);
  });

  it('shows every tab when the filter is ALL', () => {
    applyPanelCategoryFilter(fixture.sidebar, 'recording');
    applyPanelCategoryFilter(fixture.sidebar, PANEL_CATEGORY_FILTER_ALL);
    expect(visibleIds(fixture.sidebar)).toEqual([
      'panel-general',
      'panel-domain',
      'panel-recording-conditions',
      'panel-tag-cluster',
      'panel-diagnostics',
      'panel-export-logs',
    ]);
  });

  it('hides the report-bug action button never (data-panel なしは対象外)', () => {
    applyPanelCategoryFilter(fixture.sidebar, 'analysis');
    expect(fixture.tabs.reportBug.hidden).toBe(false);
  });

  describe('settings subgroup 状態', () => {
    it('reveals the subgroup while the filtered category has settings children', () => {
      expect(fixture.subgroup.hidden).toBe(false);
      // 分類フィルタが有効な間は、可視 settings 子があれば subgroup を開く。
      applyPanelCategoryFilter(fixture.sidebar, 'recording');
      expect(fixture.subgroup.hidden).toBe(false);
      expect(fixture.tabs.domain.hidden).toBe(false);
    });

    it('collapses the subgroup when the filtered category has no settings children', () => {
      applyPanelCategoryFilter(fixture.sidebar, 'analysis');
      expect(fixture.subgroup.hidden).toBe(true);
      expect(fixture.tabs.tagCluster.hidden).toBe(false);
    });

    it('restores the toggle-owned rule when the filter returns to ALL (settings 子がアクティブ)', () => {
      applyPanelCategoryFilter(fixture.sidebar, 'recording');
      fixture.tabs.domain.classList.add('active');
      applyPanelCategoryFilter(fixture.sidebar, PANEL_CATEGORY_FILTER_ALL);
      expect(fixture.subgroup.hidden).toBe(false);
    });

    it('restores the toggle-owned rule when the filter returns to ALL (settings 子以外がアクティブ)', () => {
      applyPanelCategoryFilter(fixture.sidebar, 'recording');
      fixture.tabs.tagCluster.classList.add('active');
      applyPanelCategoryFilter(fixture.sidebar, PANEL_CATEGORY_FILTER_ALL);
      expect(fixture.subgroup.hidden).toBe(true);
    });

    it('collapses the subgroup on ALL when no tab is active (wire 直後と同じ規約)', () => {
      applyPanelCategoryFilter(fixture.sidebar, 'recording');
      applyPanelCategoryFilter(fixture.sidebar, PANEL_CATEGORY_FILTER_ALL);
      expect(fixture.subgroup.hidden).toBe(true);
    });

    it('is a no-op without a subgroup (単体テスト fixture)', () => {
      fixture.subgroup.remove();
      expect(() => applyPanelCategoryFilter(fixture.sidebar, 'recording')).not.toThrow();
    });
  });

  describe('セクション見出しの可視性', () => {
    it('hides a section label whose section has no visible panels', () => {
      applyPanelCategoryFilter(fixture.sidebar, 'analysis');
      // Settings: panel-general (hidden) + subgroup 子 (全 hidden) → 見出しも隠す。
      expect(fixture.labels.settingsLabel.hidden).toBe(true);
      // Data: panel-tag-cluster が可視。
      expect(fixture.labels.dataLabel.hidden).toBe(false);
      // Tools: data-panel なしのアクションボタンが可視のまま。
      expect(fixture.labels.toolsLabel.hidden).toBe(false);
    });

    it('shows every section label when the filter is ALL', () => {
      applyPanelCategoryFilter(fixture.sidebar, 'analysis');
      applyPanelCategoryFilter(fixture.sidebar, PANEL_CATEGORY_FILTER_ALL);
      for (const label of Object.values(fixture.labels)) {
        expect(label.hidden).toBe(false);
      }
    });

    it('keeps a revealed subgroup counting toward its section label', () => {
      applyPanelCategoryFilter(fixture.sidebar, 'recording');
      // subgroup が開いて recording 子が可視 → Settings 見出しは残る。
      expect(fixture.labels.settingsLabel.hidden).toBe(false);
    });
  });
});

describe('wirePanelCategoryFilter', () => {
  let fixture: CategoryFilterFixture;
  let select: HTMLSelectElement;

  beforeEach(() => {
    fixture = buildSidebar();
    document.body.appendChild(fixture.sidebar);
    select = document.createElement('select');
    select.id = 'panelCategoryFilter';
    for (const value of ['all', 'setup', 'recording', 'ai', 'privacy', 'analysis', 'export', 'other']) {
      const option = document.createElement('option');
      option.value = value;
      select.appendChild(option);
    }
    document.body.appendChild(select);
  });

  afterEach(() => {
    fixture.sidebar.remove();
    select.remove();
  });

  it('applies the initial select value on wire', () => {
    select.value = 'other';
    wirePanelCategoryFilter(select, fixture.sidebar);
    expect(visibleIds(fixture.sidebar)).toEqual(['panel-diagnostics']);
  });

  it('applies the select value on change', () => {
    wirePanelCategoryFilter(select, fixture.sidebar);
    select.value = 'recording';
    select.dispatchEvent(new Event('change'));
    expect(visibleIds(fixture.sidebar)).toEqual(['panel-domain', 'panel-recording-conditions']);
  });

  it('is a no-op without a select', () => {
    expect(() => wirePanelCategoryFilter(null, fixture.sidebar)).not.toThrow();
  });

  it('is a no-op without a sidebar', () => {
    expect(() => wirePanelCategoryFilter(select, null)).not.toThrow();
  });
});
