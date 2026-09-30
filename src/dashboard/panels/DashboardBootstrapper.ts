import { NavigationRegistry } from './NavigationRegistry.js';
import { DEFAULT_PANEL_ID, PANEL_CATALOG, type PanelCatalogId } from './panelCatalog.js';
import { type PanelLifecycle } from './types.js';

/**
 * Settings panels shown only while the settings subgroup is expanded
 * (everything in the settings sidebar section except the Initial Setup
 * toggle itself). Derived from the catalog so a panel added to the
 * settings section automatically joins the collapsible group.
 */
const SETTINGS_CHILD_IDS: ReadonlySet<string> = new Set(
  PANEL_CATALOG.filter((e) => e.sidebarSection === 'settings' && e.id !== DEFAULT_PANEL_ID).map(
    (e) => e.id,
  ),
);

export class DashboardBootstrapper {
  private sidebar: HTMLElement | null = null;

  constructor(private registry: NavigationRegistry) {}

  registerPanels(panels: PanelLifecycle[]): void {
    for (const panel of panels) {
      this.registry.register(panel);
    }
  }

  /**
   * 正規の登録経路 (PBI 2026-09-07-25)。存在と順序は PANEL_CATALOG が所有し、
   * Bootstrapper はカタログ順に生成・登録する場所になったことで
   * pass-through 以上の役割 (登録順序の所有) を持つ。`registerPanels` は
   * 既存テスト互換の薄い互換 API として残す。再評価の記録は
   * whywhy/pbi25-catalog.md「Why3」。
   */
  registerCatalog(createPanel: (id: PanelCatalogId) => PanelLifecycle): void {
    for (const entry of PANEL_CATALOG) {
      this.registry.register(createPanel(entry.id));
    }
  }

  #updateActiveTabForPanel(panelId: string): void {
    if (!this.sidebar) return;
    const btn = this.sidebar.querySelector<HTMLElement>(`[data-panel="${panelId}"]`);
    if (!btn) return;
    const tabs = Array.from(this.sidebar.querySelectorAll<HTMLElement>('.sidebar-nav-btn'));
    tabs.forEach((el) => {
      const isActive = el === btn;
      el.classList.toggle('active', isActive);
      el.setAttribute('aria-selected', isActive ? 'true' : 'false');
      el.setAttribute('tabindex', isActive ? '0' : '-1');
    });
  }

  /**
   * Shows or hides the settings subgroup (the settings-section buttons under
   * the Initial Setup toggle). No subgroup in the DOM (unit-test fixtures,
   * future layouts) is a no-op, so plain button lists keep working.
   */
  #setSettingsExpanded(expanded: boolean): void {
    if (!this.sidebar) return;
    const group = this.sidebar.querySelector<HTMLElement>('#settingsSubgroup');
    if (!group) return;
    group.hidden = !expanded;
    const toggle = this.sidebar.querySelector<HTMLElement>(`[data-panel="${DEFAULT_PANEL_ID}"]`);
    toggle?.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  /**
   * Follows a navigation that did not go through the sidebar click handler
   * (deep link, in-panel jump): a settings child must reveal its own button,
   * a non-settings panel collapses the group again. The Initial Setup panel
   * itself leaves the state untouched so the group only opens on an explicit
   * press of its button (or on landing inside the group).
   */
  #syncSettingsGroupOnNavigate(panelId: string): void {
    if (panelId === DEFAULT_PANEL_ID) return;
    this.#setSettingsExpanded(SETTINGS_CHILD_IDS.has(panelId));
  }

  wireSidebar(sidebar: HTMLElement): void {
    this.sidebar = sidebar;
    // Settings children stay hidden until the Initial Setup button is
    // pressed (or a navigation lands inside the group).
    this.#setSettingsExpanded(false);
    // Programmatic navigations (registry.navigate from inside a panel) bypass
    // the click handler below, so sync the sidebar on every navigation. This
    // keeps aria-selected correct no matter how the panel was opened.
    this.registry.onDidNavigate((panelId) => {
      this.#updateActiveTabForPanel(panelId);
      this.#syncSettingsGroupOnNavigate(panelId);
    });
    const getTabs = (): HTMLElement[] => {
      return Array.from(sidebar.querySelectorAll<HTMLElement>('.sidebar-nav-btn')).filter((el) => {
        // Arrow-key navigation skips buttons hidden inside the collapsed
        // settings subgroup. Buttons without a subgroup ancestor (or without
        // any subgroup in the DOM) are always reachable.
        const group = el.closest('#settingsSubgroup');
        return !(group instanceof HTMLElement && group.hidden);
      });
    };

    const setRovingTabindex = (activeBtn: HTMLElement): void => {
      const tabs = getTabs();
      tabs.forEach((el) => {
        el.setAttribute('tabindex', el === activeBtn ? '0' : '-1');
      });
    };

    // Initialize roving tabindex on the active tab
    const initialActive = sidebar.querySelector<HTMLElement>('.sidebar-nav-btn.active');
    if (initialActive) {
      setRovingTabindex(initialActive);
    }

    sidebar.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement;
      const btn = target.closest<HTMLElement>('[data-panel]');
      if (!btn) return;

      const panelId = btn.getAttribute('data-panel');
      if (!panelId) return;

      // The Initial Setup button doubles as the settings-group toggle:
      // pressing it reveals the settings children. Leaving the group
      // collapses it again so the settings buttons only show on demand.
      this.#setSettingsExpanded(panelId === DEFAULT_PANEL_ID || SETTINGS_CHILD_IDS.has(panelId));

      // Update sidebar active state and ARIA selection
      this.#updateActiveTabForPanel(panelId);

      void this.registry.navigate(panelId).catch(() => {
        // Panel not yet migrated to new system; old navigation handles it
      });
    });

    sidebar.addEventListener('keydown', (e: KeyboardEvent) => {
      const tabs = getTabs();
      if (tabs.length === 0) return;

      const currentIndex = tabs.indexOf(document.activeElement as HTMLElement);
      if (currentIndex === -1) return;

      let newIndex = currentIndex;

      switch (e.key) {
        case 'ArrowRight':
          newIndex = (currentIndex + 1) % tabs.length;
          break;
        case 'ArrowLeft':
          newIndex = (currentIndex - 1 + tabs.length) % tabs.length;
          break;
        case 'Home':
          newIndex = 0;
          break;
        case 'End':
          newIndex = tabs.length - 1;
          break;
        default:
          return;
      }

      e.preventDefault();
      tabs[newIndex]?.focus();
    });
  }

  async start(defaultPanelId?: string): Promise<void> {
    if (defaultPanelId) {
      await this.registry.navigate(defaultPanelId);
      this.#updateActiveTabForPanel(defaultPanelId);
    }
  }
}
