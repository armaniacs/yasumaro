import { NavigationRegistry } from './NavigationRegistry.js';
import { type Panel } from './types.js';

export class DashboardBootstrapper {
  constructor(private registry: NavigationRegistry) {}

  registerPanels(panels: Panel[]): void {
    for (const panel of panels) {
      this.registry.register(panel);
    }
  }

  wireSidebar(sidebar: HTMLElement): void {
    sidebar.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement;
      const btn = target.closest<HTMLElement>('[data-panel]');
      if (!btn) return;

      const panelId = btn.getAttribute('data-panel');
      if (!panelId) return;

      try {
        this.registry.navigate(panelId);
      } catch {
        // Panel not yet migrated to new system; old navigation handles it
      }
    });
  }

  async start(defaultPanelId?: string): Promise<void> {
    if (defaultPanelId) {
      this.registry.navigate(defaultPanelId);
    }
  }
}
