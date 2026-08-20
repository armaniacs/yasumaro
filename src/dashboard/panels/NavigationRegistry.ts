import { type PanelLifecycle, type PanelInitMap } from './types.js';

/**
 * NavigationRegistry manages dashboard panel lifecycle using the unified
 * PanelLifecycle interface. All panels implement PanelLifecycle directly.
 */
export class NavigationRegistry {
  private panels = new Map<string, PanelLifecycle>();
  private activePanelId: string | null = null;
  private mountedPanels = new Set<string>();

  register(panel: PanelLifecycle): void {
    if (this.panels.has(panel.id)) {
      throw new Error(`Panel "${panel.id}" is already registered`);
    }
    this.panels.set(panel.id, panel);
  }

  navigate(panelId: string, init?: Record<string, unknown>): void {
    this.#navigateInternal(panelId, init);
  }

  navigateTyped<K extends keyof PanelInitMap>(panelId: K, init?: PanelInitMap[K]): void {
    this.#navigateInternal(panelId, init);
  }

  #navigateInternal(panelId: string, init?: Record<string, unknown>): void {
    const panel = this.panels.get(panelId);
    if (!panel) {
      throw new Error(`Panel "${panelId}" is not registered`);
    }

    if (this.activePanelId === panelId) {
      (panel.init ?? panel.activate)?.(init);
      return;
    }

    if (this.activePanelId) {
      const current = this.panels.get(this.activePanelId);
      current?.deactivate?.();
    }

    // Clear any panel left `.active` in the static HTML (e.g. panel-general),
    // not just the one tracked by activePanelId, so the first programmatic
    // navigate() (activePanelId still null) doesn't leave a stale panel visible.
    for (const el of document.querySelectorAll('.panel.active')) {
      el.classList.remove('active');
    }

    this.activePanelId = panelId;

    // Show new panel
    const newEl = document.getElementById(panelId);
    newEl?.classList.add('active');

    if (!this.mountedPanels.has(panelId)) {
      const container = document.getElementById(panelId);
      if (container) {
        panel.mount(container);
      }
      this.mountedPanels.add(panelId);
    }

    (panel.init ?? panel.activate)?.(init);

    if ((panel.category === 'async-data' || panel.category === 'diagnostic') && panel.load) {
      panel.load().catch((err: unknown) => {
        console.error(`[NavigationRegistry] load failed for panel "${panelId}":`, err);
        // UI feedback for load failure: panels handle their own errors internally,
        // but an unexpected rejection (e.g., programming error) should be visible
        // rather than leaving the panel empty.
        const container = document.getElementById(panelId);
        if (container && !container.querySelector('.panel-load-error')) {
          const errEl = document.createElement('div');
          errEl.className = 'panel-load-error';
          errEl.setAttribute('role', 'alert');
          errEl.textContent = `Failed to load panel: ${err instanceof Error ? err.message : String(err)}`;
          errEl.style.cssText =
            'padding:12px;color:var(--color-error, #c00);background:var(--color-error-bg, #fee);border:1px solid var(--color-error, #c00);border-radius:4px;margin:8px 0;';
          container.prepend(errEl);
        }
      });
    }
  }

  get activeId(): string | null {
    return this.activePanelId;
  }
}
