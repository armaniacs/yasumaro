/**
 * Unified lifecycle interface for all dashboard panels.
 *
 * New panels should implement this directly. Existing panels (AsyncDataPanel,
 * StaticFormPanel, DiagnosticPanel) are wrapped by adaptLegacyPanel() to
 * conform to this shape — they don't need to change.
 *
 * The interface is intentionally minimal: mount is the only required method.
 * activate/deactivate/destroy are optional hooks that the registry calls at
 * the appropriate lifecycle points.
 */
export interface PanelLifecycle {
  readonly id: string;
  readonly category: 'async-data' | 'static-form' | 'diagnostic';
  mount(container: HTMLElement): void | Promise<void>;
  /** PBI#03 spec name for activation — alias for activate, kept for spec compliance. */
  init?(init?: Record<string, unknown>): void | Promise<void>;
  activate?(init?: Record<string, unknown>): void | Promise<void>;
  load?(): Promise<void>;
  deactivate?(): void;
  destroy?(): void;
}

/**
 * Legacy union type — kept for backward compatibility with existing panels.
 * New panels should implement PanelLifecycle instead.
 */
export type Panel = AsyncDataPanel | StaticFormPanel | DiagnosticPanel;

/**
 * Wrap a legacy panel (AsyncDataPanel / StaticFormPanel / DiagnosticPanel)
 * into the PanelLifecycle interface.
 *
 * This adapter maps:
 * - onActivate(init?) → activate(init)
 * - onDeactivate() → deactivate()
 * - loadData() → activate() (for async-data panels, registry calls activate then load)
 */
export function adaptLegacyPanel(panel: Panel): PanelLifecycle {
  const activateFn = (init?: Record<string, unknown>): void => {
    if (panel.category === 'async-data') {
      panel.onActivate?.(init);
    } else if ('onActivate' in panel) {
      panel.onActivate?.();
    }
  };
  const base: PanelLifecycle = {
    id: panel.id,
    category: panel.category,
    mount: (container) => panel.mount(container),
    init: activateFn,
    activate: activateFn,
    deactivate: () => {
      if (panel.category === 'async-data') {
        panel.onDeactivate?.();
      }
    },
    destroy: () => {
      if ('unmount' in panel) {
        panel.unmount?.();
      }
    },
  };
  if (panel.category === 'async-data') {
    base.load = () => panel.loadData();
  }
  return base;
}

export interface AsyncDataPanel {
  readonly id: string;
  readonly category: 'async-data';
  mount(container: HTMLElement): void;
  loadData(): Promise<void>;
  unmount?(): void;
  onActivate?(init?: Record<string, unknown>): void;
  onDeactivate?(): void;
}

export interface StaticFormPanel {
  readonly id: string;
  readonly category: 'static-form';
  mount(container: HTMLElement): Promise<void>;
  /**
   * Re-read persisted settings into the already-mounted form.
   *
   * Optional: NavigationRegistry never calls this — panels load their data in
   * mount() and the options page has no "reload settings" affordance. It is
   * kept because several panels implement it meaningfully and callers may
   * invoke it directly; panels with nothing to re-read simply omit it rather
   * than declaring an empty body to satisfy the contract.
   */
  refresh?(): Promise<void>;
  onActivate?(): void;
}

export interface DiagnosticPanel {
  readonly id: string;
  readonly category: 'diagnostic';
  mount(container: HTMLElement): Promise<void>;
  /** Re-run diagnostics collection. Optional for the same reason as StaticFormPanel.refresh. */
  refresh?(): Promise<void>;
}

export interface PanelInitMap {
  'panel-sqlite-history'?: { searchTag?: string; searchDomain?: string };
  'panel-tag-cluster'?: { focusTag?: string };
}
