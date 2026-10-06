/**
 * Unified lifecycle interface for all dashboard panels.
 *
 * All panels implement this directly.
 *
 * The interface is intentionally minimal: mount is the only required method.
 * activate/deactivate are optional hooks that the registry calls on
 * navigation. destroy is called only on page unload via
 * NavigationRegistry.destroyAll (pagehide), never on navigation.
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

export interface PanelInitMap {
  'panel-sqlite-history'?: { searchTag?: string; searchDomain?: string };
  'panel-tag-cluster'?: { focusTag?: string };
}
