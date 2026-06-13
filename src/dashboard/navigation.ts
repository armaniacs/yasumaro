/**
 * Dashboard Sidebar Navigation — ARIA Tabs Pattern
 *
 * Implements WAI-ARIA Tabs pattern for the dashboard sidebar:
 * - role="tablist" on the nav container
 * - role="tab" on each nav button with aria-selected, aria-controls
 * - role="tabpanel" on each panel with aria-labelledby
 * - Keyboard navigation: Arrow Up/Down, Home, End
 */

export function initNavigation(): void {
  let tablist = document.querySelector<HTMLElement>('[role="tablist"]');

  if (!tablist) {
    const sidebarNav = document.querySelector<HTMLElement>('#sidebar .sidebar-nav');
    if (!sidebarNav) return;
    sidebarNav.setAttribute('role', 'tablist');
    sidebarNav.setAttribute('aria-orientation', 'vertical');
    tablist = sidebarNav;
  }

  let tabs = Array.from(tablist.querySelectorAll<HTMLElement>('[role="tab"]'));

  if (tabs.length === 0) {
    const sidebarBtns = Array.from(tablist.querySelectorAll<HTMLElement>('.sidebar-nav-btn'));
    if (sidebarBtns.length === 0) return;
    sidebarBtns.forEach((btn, idx) => {
      btn.setAttribute('role', 'tab');
      if (!btn.id) btn.id = `sidebar-tab-${idx}`;
      const panelId = btn.getAttribute('data-panel');
      if (panelId) btn.setAttribute('aria-controls', panelId);
    });
    tabs = sidebarBtns;
  }

  tabs.forEach((tab) => {
    const panelId = tab.getAttribute('aria-controls');
    if (panelId) {
      const panel = document.getElementById(panelId);
      if (panel) {
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', tab.id);
      }
    }
  });

  const activate = (index: number): void => {
    tabs.forEach((tab, i) => {
      const selected = i === index;
      tab.setAttribute('aria-selected', String(selected));
      tab.setAttribute('tabindex', selected ? '0' : '-1');
      const panelId = tab.getAttribute('aria-controls') || tab.getAttribute('data-panel');
      if (panelId) {
        const panel = document.getElementById(panelId);
        if (panel) {
          if (selected) {
            panel.classList.add('active');
            panel.removeAttribute('hidden');
          } else {
            panel.classList.remove('active');
            panel.setAttribute('hidden', '');
          }
        }
      }
      if (selected) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });
  };

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => {
      activate(i);
    });

    tab.addEventListener('keydown', (e) => {
      const key = (e as KeyboardEvent).key;
      let targetIndex: number | null = null;

      if (key === 'ArrowRight' || key === 'ArrowDown') {
        e.preventDefault();
        targetIndex = (i + 1) % tabs.length;
      } else if (key === 'ArrowLeft' || key === 'ArrowUp') {
        e.preventDefault();
        targetIndex = (i - 1 + tabs.length) % tabs.length;
      } else if (key === 'Home') {
        e.preventDefault();
        targetIndex = 0;
      } else if (key === 'End') {
        e.preventDefault();
        targetIndex = tabs.length - 1;
      }

      if (targetIndex !== null) {
        tabs[targetIndex]!.focus();
        activate(targetIndex);
      }
    });
  });

  const activeIndex = tabs.findIndex((tab) =>
    tab.classList.contains('active') || tab.getAttribute('aria-selected') === 'true'
  );
  activate(activeIndex >= 0 ? activeIndex : 0);
}
