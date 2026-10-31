/**
 * panelCategories.ts — パネル分類の単一の真実の源 (PBI 2026-10-31-08)。
 *
 * 29 パネルの平らな並びでは発見可能性が落ちるため、パネルを機能単位の
 * 分類に割り当てる。sidebar の所属セクション・存在・順序は panelCatalog.ts
 * が所有し、このテーブルが所有するのは「パネル → 分類」の割り当てのみ。
 * 割り当て表に記載のないパネルは categoryForPanel が 'other' に倒す
 * (BDD 境界値: 分類未割り当てパネルは「その他」に配置され辿り着ける)。
 *
 * panelCatalog.ts と同じく import を持たない純粋メタデータ (循環参照の
 * 回避)。分類名の i18n キーが両 locale の messages.json に実在することは
 * __tests__/panelCategories.test.ts で担保する。
 */

/** 分類フィルタの解除値 (「すべてのパネル」option)。 */
export const PANEL_CATEGORY_FILTER_ALL = 'all';

export type PanelCategoryId =
  | 'setup'
  | 'recording'
  | 'ai'
  | 'privacy'
  | 'analysis'
  | 'export'
  | 'other';

/** 分類 UI (select) の表示順。先頭の 'all' option は wire 側が先頭に置く。 */
export const PANEL_CATEGORY_ORDER: readonly PanelCategoryId[] = [
  'setup',
  'recording',
  'ai',
  'privacy',
  'analysis',
  'export',
  'other',
];

/** 分類名の i18n キー (select の option は data-i18n-opt で参照する)。 */
export const PANEL_CATEGORIES: Readonly<
  Record<PanelCategoryId, { readonly i18nKey: string }>
> = {
  setup: { i18nKey: 'panelCategorySetup' },
  recording: { i18nKey: 'panelCategoryRecording' },
  ai: { i18nKey: 'panelCategoryAi' },
  privacy: { i18nKey: 'panelCategoryPrivacy' },
  analysis: { i18nKey: 'panelCategoryAnalysis' },
  export: { i18nKey: 'panelCategoryExport' },
  other: { i18nKey: 'panelCategoryOther' },
};

/**
 * パネル → 分類の割り当て表。'other' はフォールバック専用のため割り当てない
 * (割り当て表に記載のないパネルが 'other' に落ちる規約をテストで固定)。
 */
export const CATEGORY_PANEL_IDS: Readonly<
  Record<Exclude<PanelCategoryId, 'other'>, readonly string[]>
> = {
  // 初期設定・接続: Obsidian 接続と AI プロバイダの入り口。
  setup: ['panel-general'],
  // 記録設定: 何をどの条件で記録するかの意思決定。
  recording: ['panel-domain', 'panel-content', 'panel-recording-conditions', 'panel-tags'],
  // AI 要約: 要約のプロンプトと事前クレンジング。
  ai: ['panel-prompt', 'panel-ai-summary-cleansing'],
  // プライバシー・セキュリティ: 保存先の安全とアクセス制御。
  privacy: ['panel-privacy', 'panel-trust', 'panel-csp'],
  // 履歴・分析: 記録済みデータの閲覧と可視化。
  analysis: [
    'panel-tag-cluster',
    'panel-sqlite-history',
    'panel-archive',
    'panel-domain-search',
    'panel-time-heatmap',
    'panel-domain-analysis',
    'panel-revisit-insights',
    'panel-research-sessions',
    'panel-tag-frequency-timeline',
    'panel-tag-cooccurrence-table',
    'panel-word-cluster',
    'panel-similarity-cluster',
    'panel-tag-cluster-time-slider',
    'panel-session-timeline',
  ],
  // 出力: 記録の書き出しとテンプレート。
  export: [
    'panel-markdown-template',
    'panel-webhook-export',
    'panel-export-logs',
    'panel-export-import',
  ],
};

const CATEGORY_BY_PANEL_ID: ReadonlyMap<string, PanelCategoryId> = new Map(
  Object.entries(CATEGORY_PANEL_IDS).flatMap(([categoryId, panelIds]) =>
    panelIds.map((panelId) => [panelId, categoryId as PanelCategoryId]),
  ),
);

/** パネルを分類へ割り当てる。未割り当てパネルは 'other' (フォールバック)。 */
export function categoryForPanel(panelId: string): PanelCategoryId {
  return CATEGORY_BY_PANEL_ID.get(panelId) ?? 'other';
}
