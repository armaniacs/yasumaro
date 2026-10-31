import { SETTINGS_SUBGROUP_PANEL_IDS } from './panelCatalog.js';
import { categoryForPanel, PANEL_CATEGORY_FILTER_ALL } from './panelCategories.js';

/** 分類フィルタの解除値 ('all')。定義は panelCategories、消費者の参照経路はこちら。 */
export { PANEL_CATEGORY_FILTER_ALL };

/**
 * panelCategoryFilter.ts — パネル分類 UI の可視性制御 (PBI 2026-10-31-08)。
 *
 * select で選ばれた分類以外の sidebar ボタンを hidden 属性で隠す。状態は
 * DOM の hidden 属性のみで保持し (storage キーは増やさない)、パネルの
 * 表示自体は registry の navigate が所有する。アクティブタブがフィルタで
 * 隠れたときだけ、選択分類の先頭の可視タブへ navigate で選択を移す
 * (aria-selected・アクティブタブ・表示パネルの同期は navigate 先の
 * onDidNavigate が所有するため、ここでは発火のみ)。
 *
 * 責務の境界:
 * - ナビボタンの hidden: このモジュールが所有する (data-panel 付きのみ。
 *   「不具合を報告」のようなアクションボタンは対象外)
 * - settings subgroup の hidden: 折りたたみトグル (DashboardBootstrapper) が
 *   所有するが、分類フィルタが有効な間は「可視 settings 子があるときだけ
 *   開く」規約に従う。'all' に戻すとトグル所有の規約 (アクティブパネルが
 *   settings 子のときだけ開く) に復元する
 * - セクション見出しの hidden: 所属セクションに可視要素が無いときだけ閉じる
 *   (空の見出しが残ると発見可能性が落ちるため)
 * - 選択の付け替え: registry.navigate に委ねる (DashboardBootstrapper の
 *   onDidNavigate が同期する既存パターン)
 */

/** sidebar のナビボタンを選択分類で絞り込む。 */
export function applyPanelCategoryFilter(
  sidebar: HTMLElement,
  categoryId: string,
  navigate?: (panelId: string) => void,
): void {
  const tabs = sidebar.querySelectorAll<HTMLElement>('.sidebar-nav-btn[data-panel]');
  for (const tab of tabs) {
    const panelId = tab.getAttribute('data-panel');
    const visible =
      categoryId === PANEL_CATEGORY_FILTER_ALL ||
      (panelId !== null && categoryForPanel(panelId) === categoryId);
    tab.hidden = !visible;
  }
  syncSettingsSubgroup(sidebar, categoryId);
  syncSectionLabels(sidebar);
  navigateIfActiveTabHidden(sidebar, navigate);
}

/**
 * フィルタでアクティブタブが隠れたとき、選択分類の先頭の可視タブへ選択を
 * 移す (修正ラウンド)。隠れたタブに aria-selected="true" が残ると可視
 * tablist に選択がなくなり、コンテンツ領域には分類外のパネルが表示され
 * 続ける。navigate は DashboardBootstrapper の onDidNavigate (wireSidebar)
 * が aria-selected・active・subgroup 開閉を同期する既存パターンに委ねる。
 * アクティブタブなし (wire 直後) は触らない — 初期表示は start() が
 * 所有するため。
 */
function navigateIfActiveTabHidden(sidebar: HTMLElement, navigate?: (panelId: string) => void): void {
  if (!navigate) return;
  const activeTab = sidebar.querySelector<HTMLElement>('.sidebar-nav-btn.active');
  if (!activeTab || !activeTab.hidden) return;
  const firstVisible = sidebar.querySelector<HTMLElement>(
    '.sidebar-nav-btn[data-panel]:not([hidden])',
  );
  const panelId = firstVisible?.getAttribute('data-panel') ?? null;
  if (panelId !== null) navigate(panelId);
}

/** 分類フィルタに応じて settings subgroup の開閉を同期する。 */
function syncSettingsSubgroup(sidebar: HTMLElement, categoryId: string): void {
  const subgroup = sidebar.querySelector<HTMLElement>('#settingsSubgroup');
  if (!subgroup) return;
  if (categoryId === PANEL_CATEGORY_FILTER_ALL) {
    // トグル所有の規約に復元: アクティブパネルが settings 子のときだけ開く
    // (wire 直後の既定と同じ)。アクティブタブなしは折りたたむ。
    const activePanelId =
      sidebar.querySelector<HTMLElement>('.sidebar-nav-btn.active')?.getAttribute('data-panel') ??
      null;
    subgroup.hidden = !SETTINGS_SUBGROUP_PANEL_IDS.has(activePanelId ?? '');
    return;
  }
  // 分類フィルタが有効な間は、絞り込まれた settings 子が見えるように開く。
  const hasVisibleChild = subgroup.querySelector('.sidebar-nav-btn:not([hidden])') !== null;
  subgroup.hidden = !hasVisibleChild;
}

/** 所属セクションに可視要素が無いセクション見出しを隠す。 */
function syncSectionLabels(sidebar: HTMLElement): void {
  const nav = sidebar.querySelector<HTMLElement>('.sidebar-nav');
  if (!nav) return;
  let label: HTMLElement | null = null;
  let sectionHasContent = false;
  const flush = (): void => {
    if (label) label.hidden = !sectionHasContent;
    label = null;
    sectionHasContent = false;
  };
  for (const child of Array.from(nav.children)) {
    const el = child as HTMLElement;
    if (el.classList.contains('sidebar-section-label')) {
      flush();
      label = el;
    } else if (el.classList.contains('sidebar-divider')) {
      flush();
    } else if (el.classList.contains('sidebar-subgroup')) {
      // display: contents の subgroup 子は所属セクションの要素として数える。
      sectionHasContent =
        sectionHasContent ||
        (!el.hidden && el.querySelector('.sidebar-nav-btn:not([hidden])') !== null);
    } else {
      sectionHasContent = sectionHasContent || !el.hidden;
    }
  }
  flush();
}

/** 分類 select と sidebar を結線する。select なし (単体テスト fixture) は no-op。 */
export function wirePanelCategoryFilter(
  select: HTMLSelectElement | null,
  sidebar: HTMLElement | null,
  navigate?: (panelId: string) => void,
): void {
  if (!select || !sidebar) return;
  const apply = (): void => {
    applyPanelCategoryFilter(sidebar, select.value, navigate);
  };
  select.addEventListener('change', apply);
  apply();
}
