import { type PanelLifecycle, type PanelInitMap } from './types.js';
import { errorMessage } from '../../utils/errorUtils.js';

/**
 * NavigationRegistry manages dashboard panel lifecycle using the unified
 * PanelLifecycle interface. All panels implement PanelLifecycle directly.
 */
export class NavigationRegistry {
  private panels = new Map<string, PanelLifecycle>();
  private activePanelId: string | null = null;
  private mountedPanels = new Set<string>();
  private navigateListeners = new Set<(panelId: string) => void>();
  // Bumped at the start of every #navigateInternal call so a navigate() that
  // gets superseded by a newer one while suspended at an await can detect it
  // is stale and skip its remaining (visible) side effects.
  private navGeneration = 0;

  /**
   * Fired as soon as a navigation is decided (before panel.mount()/activate()
   * are awaited, so before the navigation has actually settled) — including
   * programmatic ones (e.g. privacySettingsPanel's export-logs jump) that
   * bypass the sidebar click handler. DashboardBootstrapper subscribes to
   * keep the sidebar's active/aria-selected state in sync immediately, so
   * a11y never depends on *how* the navigation was triggered or on the
   * panel's mount finishing. Returns an unsubscribe function.
   */
  onDidNavigate(listener: (panelId: string) => void): () => void {
    this.navigateListeners.add(listener);
    return () => { this.navigateListeners.delete(listener); };
  }

  register(panel: PanelLifecycle): void {
    if (this.panels.has(panel.id)) {
      throw new Error(`Panel "${panel.id}" is already registered`);
    }
    this.panels.set(panel.id, panel);
  }

  navigate(panelId: string, init?: Record<string, unknown>): Promise<void> {
    return this.#navigateInternal(panelId, init);
  }

  navigateTyped<K extends keyof PanelInitMap>(panelId: K, init?: PanelInitMap[K]): Promise<void> {
    return this.#navigateInternal(panelId, init);
  }

  async #navigateInternal(panelId: string, init?: Record<string, unknown>): Promise<void> {
    const generation = ++this.navGeneration;

    const panel = this.panels.get(panelId);
    if (!panel) {
      throw new Error(`Panel "${panelId}" is not registered`);
    }

    if (this.activePanelId === panelId) {
      await (panel.init ?? panel.activate)?.(init);
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

    for (const listener of this.navigateListeners) {
      try {
        listener(panelId);
      } catch (err) {
        console.error(`[NavigationRegistry] navigate listener failed for panel "${panelId}":`, err);
      }
    }

    // Show new panel
    const newEl = document.getElementById(panelId);
    newEl?.classList.add('active');

    if (!this.mountedPanels.has(panelId)) {
      const container = document.getElementById(panelId);
      if (container) {
        // Awaited so callers (e.g. reload -> navigate to default panel) only
        // see navigate() resolve once the panel's dynamically-built DOM
        // (e.g. #geminiSettings) actually exists. See design doc
        // docs/superpowers/specs/2026-09-19-navigation-registry-mount-await-design.md
        await panel.mount(container);
      }
      // The mount itself is real work that happened and must not be redone,
      // even if a newer navigate() has since superseded this one — so this
      // tracking update always runs, regardless of generation.
      this.mountedPanels.add(panelId);
    }

    // A newer navigate() call may have deactivated this panel and taken over
    // activePanelId while we were suspended at the mount await above. Calling
    // init/activate/load on a panel that's no longer the target would be
    // wasted work on an already-hidden panel (and could surface a load-error
    // banner nobody can see), so bail out silently here.
    if (generation !== this.navGeneration) return;

    await (panel.init ?? panel.activate)?.(init);

    if (generation !== this.navGeneration) return;

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
          errEl.textContent = `Failed to load panel: ${errorMessage(err)}`;
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
