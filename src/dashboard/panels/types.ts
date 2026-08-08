export type Panel = AsyncDataPanel | StaticFormPanel | DiagnosticPanel;

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
