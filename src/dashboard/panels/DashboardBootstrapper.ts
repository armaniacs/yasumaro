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
    const updateActiveTab = (activeBtn: HTMLElement): void => {
      sidebar.querySelectorAll('.sidebar-nav-btn').forEach((el) => {
        const isActive = el === activeBtn;
        el.classList.toggle('active', isActive);
        el.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
    };

    sidebar.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement;
      const btn = target.closest<HTMLElement>('[data-panel]');
      if (!btn) return;

      const panelId = btn.getAttribute('data-panel');
      if (!panelId) return;

      // Update sidebar active state and ARIA selection
      updateActiveTab(btn);

      try {
        this.registry.navigate(panelId);
      } catch {
        // Panel not yet migrated to new system; old navigation handles it
      }
    });
  }

  start(defaultPanelId?: string): void {
    if (defaultPanelId) {
      this.registry.navigate(defaultPanelId);
    }
  }
}
