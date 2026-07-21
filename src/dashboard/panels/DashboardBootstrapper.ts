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
    const getTabs = (): HTMLElement[] => {
      return Array.from(sidebar.querySelectorAll<HTMLElement>('.sidebar-nav-btn'));
    };

    const setRovingTabindex = (activeBtn: HTMLElement): void => {
      const tabs = getTabs();
      tabs.forEach((el) => {
        el.setAttribute('tabindex', el === activeBtn ? '0' : '-1');
      });
    };

    const updateActiveTab = (activeBtn: HTMLElement): void => {
      const tabs = getTabs();
      tabs.forEach((el) => {
        const isActive = el === activeBtn;
        el.classList.toggle('active', isActive);
        el.setAttribute('aria-selected', isActive ? 'true' : 'false');
        el.setAttribute('tabindex', isActive ? '0' : '-1');
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

      // Update sidebar active state and ARIA selection
      updateActiveTab(btn);

      try {
        this.registry.navigate(panelId);
      } catch {
        // Panel not yet migrated to new system; old navigation handles it
      }
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
      tabs[newIndex].focus();
    });
  }

  start(defaultPanelId?: string): void {
    if (defaultPanelId) {
      this.registry.navigate(defaultPanelId);
    }
  }
}
