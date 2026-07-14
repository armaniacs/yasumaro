import { type Panel, type PanelInitMap } from './types.js';

export class NavigationRegistry {
  private panels = new Map<string, Panel>();
  private activePanelId: string | null = null;
  private mountedPanels = new Set<string>();

  register(panel: Panel): void {
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
      (panel as { onActivate?(init?: Record<string, unknown>): void }).onActivate?.(init);
      return;
    }

    if (this.activePanelId) {
      const current = this.panels.get(this.activePanelId);
      (current as { onDeactivate?(): void } | undefined)?.onDeactivate?.();
      // Hide previous panel
      const prevEl = document.getElementById(this.activePanelId);
      prevEl?.classList.remove('active');
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

    (panel as { onActivate?(init?: Record<string, unknown>): void }).onActivate?.(init);

    if (panel.category === 'async-data') {
      (panel as { loadData(): Promise<void> }).loadData().catch((err: unknown) => {
        console.error(`[NavigationRegistry] loadData failed for panel "${panelId}":`, err);
      });
    }
  }

  get activeId(): string | null {
    return this.activePanelId;
  }
}
