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
  refresh(): Promise<void>;
  onActivate?(): void;
}

export interface DiagnosticPanel {
  readonly id: string;
  readonly category: 'diagnostic';
  mount(container: HTMLElement): Promise<void>;
  refresh(): Promise<void>;
}

export interface PanelInitMap {
  'panel-sqlite-history'?: { searchTag?: string; searchDomain?: string };
  'panel-tag-cluster'?: { focusTag?: string };
}
