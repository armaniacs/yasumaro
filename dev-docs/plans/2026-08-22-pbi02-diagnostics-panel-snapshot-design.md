# diagnosticsPanel Snapshot リファクタリング設計

- **日付**: 2026-08-22
- **状態**: 承認済み（ブレインストーミング合意）
- **対象**: `pbi/2026-08-22-02-refactor-diagnostics-panel-deepening.md`

## 1. 目的と受け入れ基準

diagnosticsPanel.ts（683行）を「collect() → DiagnosticsSnapshot → render(Snapshot)」の1 seam に再構成し、データ収集を DiagnosticsCollector へ完全集約する。

受け入れ基準:

1. `diagnosticsPanel.ts` を400行未満にする。`getSettings` / `chrome.storage.local.get` を import しない
2. 全セクションのデータを `collect(): Promise<DiagnosticsSnapshot>` の単一エントリポイントに集約する
3. `renderBuiltInAiStatus` を含む整形関数はパネル側に残し、Snapshot 入力の純粋描画にする
4. 既存 lifecycle テスト19件を維持しつつ、セクション内容の正しさは collector の Snapshot 断言で検証する
5. migrate/backfill/cleanup の confirm dialog 挙動とエラー表示を現行どおり維持する
6. `npm run type-check` / `npm test` がパスする

## 2. アーキテクチャとファイル構成

```
src/dashboard/panels/diagnostic/
├── DiagnosticsCollector.ts   (約230行) 収集専用。collect(): Promise<DiagnosticsSnapshot>
│                                        - SQLite status のリトライ（retryWithExponentialBackoff、
│                                          最大4回・指数バックオフ）をデフォルト依存に取り込む
├── debugModeStore.ts         (新規 約25行) getDebugMode()/setDebugMode() の薄い port。
│                                        キー名 'debugMode' の直書きをこの1箇所に集約する
├── diagnosticsActions.ts     (新規 約250行) ボタンハンドラ群。要素参照と callback を受け取る
├── diagnosticsPanel.ts       (目標 300〜350行) wiring + Snapshot 描画のみ
└── __tests__/                既存3件 + collector の Snapshot 断言拡充 + actions テスト新規
```

責務境界:

| モジュール | 担当 | 禁止 |
|---|---|---|
| DiagnosticsCollector | データ収集・派生計算（deficiencies, divergence） | DOM 操作 |
| debugModeStore | debugMode の読み書き | — |
| diagnosticsActions | ユーザー起因の操作（テスト実行・破壊的操作） | load 時のデータ収集 |
| diagnosticsPanel | Snapshot の描画 + wiring | getSettings / chrome.storage 直呼び |

## 3. DiagnosticsSnapshot 型定義

```typescript
export interface ProviderDetail {
  provider: string;
  model: string | undefined;
  label: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface DiagnosticsSnapshot {
  storage: { bytesUsedKb: string; savedUrls: string };
  sqlite: {
    initialized: boolean;
    path: string;
    fallback: boolean;
    fts5: boolean;
    compileOptions?: string[];
    compileOptionsSource?: 'opfs-worker' | 'idb' | 'fallback';
    initError?: string;
    opfsMigrationV2Done?: boolean;
    opfsMigrationV2LastAttemptedAt?: string | null;
    opfsMigrationV2CompletedAt?: string | null;
    opfsMigrationV2RecordCount?: number;
  } | null;
  deficiencies: ReturnType<typeof diagnoseDeficiencies>;
  builtInAi: BuiltInAiDiagnosticsResult | null;
  obsidian: { protocol: string; port: string; apiKey: string; dailyPath: string };
  aiProviders: Array<{ provider: string; model: string | undefined; label: string }>;
  aiProviderDetails: ProviderDetail[];
  extInfo: { version: string; name: string };
  divergence: { dashboardDetectsOpfs: boolean; offscreenUsesFallback: boolean };
  settingsLoadFailed: boolean;
  debugMode: boolean;
}
```

`aiProviderDetails` はプロバイダ別の設定キー集合を collector 内の switch で解決する:
gemini(model, apiKey) / openai(baseUrl, model, apiKey) / openai2(同) / lm-studio(baseUrl, model) /
ollama(baseUrl, model) / openai-compatible(baseUrl, model, apiKey)。優先リスト未設定時は
legacy AI_PROVIDER 値で1スロットにフォールバックする。

## 4. データフローとエラーハンドリング

```
load() → collect() 1回 → Snapshot → 各セクション描画ブロックへ渡す
```

セクションごとの失敗分離（1セクションの失敗が他セクションの描画を妨げない）:

| フィールド | 失敗時の値 | 描画側の挙動 |
|---|---|---|
| storage | `{ bytesUsedKb: '0.0', savedUrls: 'Unavailable' }` | そのまま表示 |
| sqlite | `null`（collector 内で4回リトライ後） | 「確認失敗」メッセージ |
| deficiencies | `[]` | sqliteStatus が null の場合は診断をスキップ |
| builtInAi | `null` | null ガードしてセクションをスキップ |
| obsidian / aiProviderDetails | settings 取得失敗時はデフォルト値群 + `settingsLoadFailed: true` | obsidianSettingsEl へ現行どおり `diagLoadError` 文言、AI セクションは空のまま |
| divergence | `detectLiveVfsStrategy()` 失敗時 `dashboardDetectsOpfs: false` | 警告非表示側に倒す（現行と同じ安全側） |
| extInfo | 失敗なし（同期API） | — |

**settingsLoadFailed の設計判断**: getSettings() は単一呼び出しで obsidian と AI の2セクションに供給するため部分失敗モードが存在せず、boolean 1個で失敗モードと1対1対応する。既存ユーザー可視挙動（エラー文言）を厳密維持する。sqlite の `null` や storage の `'Unavailable'` 文字列などフィールドごとの失敗表現は現行規約を踏襲する（全面統一はスコープ外、§9）。

**現行からの意図的な変更はない**: リトライ回数・表示文言・confirm ダイアログ・ボタンの disable/再有効化はすべて現行どおり。

## 5. debugModeStore

```typescript
export function getDebugMode(): Promise<boolean>;
export function setDebugMode(value: boolean): Promise<void>;
```

- DiagnosticsCollector のデフォルト依存（getDebugMode）がこれを使う
- パネル mount() のトグル初期化と change リスナーがこれを使う
- パネル・collector 双方から chrome.storage.local の直 import が消える

## 6. diagnosticsActions

```typescript
// 要素ID（パネル mount の querySelector と同一）:
//   ボタン: #diagTestObsidianBtn #diagTestAiBtn #diagTestSqliteBtn #diagOpfsSpikeBtn
//           #diagMigrateBtn #diagBackfillBtn #diagCleanupBtn #diagBuiltInAiDownloadBtn
//   結果表示: #diagConnectionResult #diagSqliteResult #diagOpfsSpikeResult
//            #diagMigrateResult #diagBackfillResult #diagCleanupResult
//            #diagBuiltInAiStats #diagBuiltInAiDownloadResult
export interface DiagnosticActionElements {
  testObsidianBtn: HTMLButtonElement | null;
  testAiBtn: HTMLButtonElement | null;
  testSqliteBtn: HTMLButtonElement | null;
  opfsSpikeBtn: HTMLButtonElement | null;
  migrateBtn: HTMLButtonElement | null;
  backfillBtn: HTMLButtonElement | null;
  cleanupBtn: HTMLButtonElement | null;
  builtInAiDownloadBtn: HTMLButtonElement | null;
  connectionResult: HTMLElement | null;
  sqliteResult: HTMLElement | null;
  opfsSpikeResult: HTMLElement | null;
  migrateResult: HTMLElement | null;
  backfillResult: HTMLElement | null;
  cleanupResult: HTMLElement | null;
  builtInAiStats: HTMLElement | null;
  builtInAiDownloadResult: HTMLElement | null;
}

export function createDiagnosticActions(
  els: DiagnosticActionElements,
  hooks: { onBuiltInAiDownloaded: (result: BuiltInAiDiagnosticsResult) => void },
): void;
```

null 許容の理由: パネルは querySelector の結果をそのまま渡すため。各ハンドラ内で現行どおり対象要素の null ガードを行う。

- 移植するハンドラ8種: TEST_OBSIDIAN / TEST_AI / DASHBOARD_SQLITE(status) の各接続テスト、OPFS spike、migrate（confirm 付き）、backfill、cleanup（confirm 付き）、built-in AI ダウンロード
- 各ハンドラは現行どおり「disable → Working... 表示 → try/catch → 結果表示 → finally で再有効化」
- `hooks.onBuiltInAiDownloaded` でダウンロード完了後に `renderBuiltInAiStatus` を呼ばせる。actions → panel の循環 import を回避するため直接 import しない

## 7. diagnosticsPanel の構造

### loadAndPopulate()（収集コードゼロ）

1. 要素 querySelector
2. `await diagnosticsCollector.collect()` を1回呼ぶ
3. セクション要素をクリア
4. `snapshot.debugMode` で compile options セクションの表示切替
5. snapshot の各フィールドを対応セクションへ描画（makeStatRow 使用）
6. connection result には placeholder メッセージを設定

### mount()

1. 要素 querySelector
2. `debugModeStore.getDebugMode()` でトグル初期化、change リスナーで `setDebugMode`
3. `createDiagnosticActions(els, { onBuiltInAiDownloaded })` で配線

### import の変化

削除される import: `getSettings`, `StorageKeys`, `UI_COLORS`, `dashboardSqliteService` の全関数,
`showConfirmDialog`, `retryWithExponentialBackoff`, `diagnoseDeficiencies`, `DiagnosticInput`,
`detectLiveVfsStrategy`, `checkBuiltInAiAvailability`, `startBuiltInAiDownload`,
`formatProviderHeadline`, `formatProviderDetailLines`, `pickDefined`

新規/残存 import: `getMessage`, `PROVIDER_LABELS`, `makeStatRow`, `getSeverityLabel`, 
`diagnosticsCollector` + 型, `debugModeStore`, `createDiagnosticActions`, `PanelLifecycle`,
`BuiltInAiDiagnosticsResult` 型, `BuiltInAIAvailability` 型

## 8. テスト戦略

| テストファイル | 内容 |
|---|---|
| `DiagnosticsCollector.test.ts` 拡充 | セクション別 Snapshot 断言: settingsLoadFailed 経路（getSettings reject → フラグ true + デフォルト値群）、extInfo、divergence の組合せ（dashboard OPFS検知 × offscreen fallback）、aiProviderDetails のプロバイダ別マッピング、sqlite 一時失敗→リトライ成功（fake timers） |
| `diagnosticsPanel.lifecycle.test.ts` | interface 準拠19件は無変更で全パス（公開 surface 不変）。内容断言1件は注入 deps での検証に置換 |
| `diagnosticsPanel-builtInAi.test.ts` | 無変更（renderBuiltInAiStatus の export 維持） |
| `diagnosticsActions.test.ts` 新規 | showConfirmDialog を mock した回帰保険 3〜4件: cleanup/migrate の confirm キャンセル時にサービス関数が呼ばれない、承認時には呼ばれる |

検証ゲート: `npm run type-check` / `npm run lint` / `npm test` / `npm run build` 全パス。

## 9. スコープ外

- フィールドごとの失敗表現の全面統一（null / [] / 'Unavailable' 文字列の規約統一）
- セクション描画関数の独立モジュール抽出（view 分離）
- 接続テスト進捗の client 抽出（別 backlog の保留条件付き項目）
