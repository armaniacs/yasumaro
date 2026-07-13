import { type Panel, type PanelInitMap } from './types.js';

export class NavigationRegistry {
  private panels = new Map<string, Panel>();
  private activePanelId: string | null = null;

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

    if (this.activePanelId === panelId) return;

    if (this.activePanelId) {
      const current = this.panels.get(this.activePanelId);
      (current as { onDeactivate?(): void } | undefined)?.onDeactivate?.();
    }

    this.activePanelId = panelId;

    (panel as { onActivate?(init?: Record<string, unknown>): void }).onActivate?.(init);

    if (panel.category === 'async-data') {
      void (panel as { loadData(): Promise<void> }).loadData();
    }
  }

  get activeId(): string | null {
    return this.activePanelId;
  }
}
