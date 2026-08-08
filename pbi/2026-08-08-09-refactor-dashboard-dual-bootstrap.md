# PBI: dashboard.ts の二重ブートストラップを解消する

**作成日**: 2026-08-08
**優先度**: 中
**見積もり**: 🔴高（3pt以上目安）
**副作用**: 🔴あり（Dashboard 全体の初期化経路の変更。全設定画面の回帰リスク）
**種別**: 🔧非機能追加（refactor）

---

## 背景

アーキテクチャレビュー（2026-08-08、候補1）で、Panel 抽象（ADR 2026-07-13 #1 の成果物）が**導入されたが旧ブートストラップを置き換えなかった**ことが判明した。

```typescript
// entrypoints/options/main.ts:5-6（実測）
import '../../src/dashboard/dashboard.js';   // 副作用: dashboard.ts:966 の void initDashboard()
import '../../src/dashboard/main.js';        // 副作用: NavigationRegistry + 18 panels
```

同じページに対して2つの独立した初期化系が並走し、どちらも DOM リスナーを張っている。

### 依存の向きが逆転している

新しい panel 層が旧 god module に依存する：

```typescript
// src/dashboard/panels/staticForm/generalSettingsPanel.ts:6-12（実測）
import {
  loadGeneralSettings, handleSaveOnly, handleTestObsidian, handleTestAi,
  handleTestLocalMarkdown, handlePurgeNow, handleContentPurgeNow,
  handleManualLocalMarkdownExport, handleGenerateWeeklySummary,
  handleGenerateMonthlySummary, getAiProviderElements, syncStatusToTop,
} from '../../dashboard.js';   // ← 11個を旧 god module から輸入
```

### dashboard.ts が panel 層を無視して DOM を直接操作する

| 箇所 | 内容 |
|---|---|
| 28-55行 `openSettingsPanel()` | `NavigationRegistry` を import せず、`.sidebar-nav-btn[data-panel]` を**クリック合成**して遷移 |
| 950-951行 `initDashboard()` | `historyBtn.click()` を合成して履歴パネルを開く |
| 674-824行 | Markdown エクスポートの**業務ロジック約150行**が同居。`chrome.downloads.download` を2箇所で直接呼ぶ |

### dashboard.ts 967行の内訳（実測）

| 行 | 責務 |
|---|---|
| 1-26 | import 20件 |
| 28-161 | パネル遷移（クリック合成）・AI provider 要素探索 |
| 162-211 | `loadGeneralSettings()` |
| 216-419 | 接続テストのDOM生成・進捗表示 |
| 420-545 | `handleTestAi()` — **126行**。単一最大の関数 |
| 546-661 | ローカル Markdown テスト・日付変換 |
| 662-824 | **Markdown エクスポート業務ロジック 約150行** |
| 825-924 | 薄いハンドララッパー5件・purge 処理 |
| 925-964 | i18n 初期化・`initDashboard()` |
| 966 | `void initDashboard()` — トップレベル副作用 |

### 削除テスト

`dashboard.ts` を削除すると複雑さは**集約される**。22の export は「panel の中身」「エクスポート業務ロジック」「i18n 初期化」の3種に明確に分解でき、単なる移動ではない。

### テスト不能性

Markdown エクスポートは `void initDashboard()` という**トップレベル副作用越しにしか到達できない**ためテスト不能。関連モジュールもテスト0：

| 行数 | ファイル | テスト |
|---|---|---|
| 205 | `panels/staticForm/generalSettingsPanel.ts` | 0 |
| 410 | `markdownTemplateManager.ts` | 0 |
| 122 | `settingsPipeline.ts` | 0 |

---

## 実装者向け注記: 現状の確認

```bash
# dashboard.ts の export 一覧（22件）
grep -n "^export " src/dashboard/dashboard.ts

# dashboard.ts を import しているファイル
grep -rn "from '.*dashboard\.js'" src/ entrypoints/ | grep -v __tests__

# クリック合成箇所
grep -n "\.click()" src/dashboard/dashboard.ts

# dashboard.ts のテスト（55ファイル中どれが dashboard.ts を対象にしているか）
grep -ln "from '../dashboard.js'" src/dashboard/__tests__/*.ts
```

---

## 設計

### 段階的に進める（一括変更は禁止）

3pt の規模であり、Dashboard 全体の初期化に触るため**一括変更は回帰リスクが高すぎる**。以下の順で、各段階ごとに `npm run validate` を通す。

### Phase 1: 業務ロジックの切り出し（最も安全・独立）

```
dashboard.ts 662-824行
  ↓
src/dashboard/markdownExport.ts（新規）
  - getExportBatchSize()
  - downloadDateMarkdown()
  - exportFullHistoryInBatches()
  - exportLocalMarkdownCore()
  - chrome.downloads は seam の裏へ
```

**この段階だけで「テスト不能だった150行が単体テスト可能になる」という主目的の大半が達成される。**

### Phase 2: 逆依存の解消

11個のハンドラを `generalSettingsPanel` 側へ移す。`dashboard.ts` からの import を削除。

### Phase 3: クリック合成の置換

`openSettingsPanel()` / `initDashboard()` のクリック合成を `getRegistry().navigateTyped()` に置換。

**注意**: PBI `2026-08-08-03`（Panel 契約の整理）で `navigateTyped` を実遷移に採用する。本PBIはその後に実施するのが自然。

### Phase 4: 単一ブートストラップ化

`entrypoints/options/main.ts` の import を `main.ts` 一本にし、`dashboard.ts` を削除。

### 最終形

```
entrypoints/options/main.ts
  └→ dashboard/main.ts（単一 bootstrap）
       └→ NavigationRegistry
            ├→ generalSettingsPanel（自己完結）
            │    └→ markdownExport（業務ロジック・テスト可能）
            │         └→ downloadPort（chrome.downloads seam）
            └→ ...17 panels
```

---

## 受け入れ基準（BDD）

```gherkin
Scenario: Markdown エクスポートが単体テスト可能になる
  Given markdownExport がモジュールとして独立している
  When エクスポートのバッチ分割・日付バケット処理をテストする
  Then Dashboard の初期化に依存せずに検証できる

Scenario: panel 層が旧 god module に依存しない
  Given generalSettingsPanel が自己完結している
  When import を確認する
  Then dashboard.ts からの import が存在しない

Scenario: パネル遷移が registry を通る
  Given NavigationRegistry がパネル遷移を管理する
  When 設定パネルを開く
  Then クリック合成ではなく registry の API が使われる

Scenario: 初期化が1系統になる
  Given entrypoints/options/main.ts が bootstrap を import する
  When import を確認する
  Then dashboard.ts の import が存在しない

Scenario: 既存テストが全てパスする
  When 各 Phase を完了する
  Then npm run validate が成功する
```

## 受け入れ基準

### Phase 1
- [ ] `src/dashboard/markdownExport.ts` を新規作成し、662-824行の業務ロジックを移動
- [ ] `chrome.downloads.download` を seam の裏に隠す
- [ ] `markdownExport` の単体テストを新規作成
- [ ] `npm run validate` が成功する

### Phase 2
- [ ] 11個のハンドラを `generalSettingsPanel` へ移動
- [ ] `generalSettingsPanel` から `dashboard.js` の import を削除
- [ ] `generalSettingsPanel` の単体テストを新規作成（現状0）
- [ ] `npm run validate` が成功する

### Phase 3
- [ ] `openSettingsPanel()` のクリック合成を registry 経由に置換
- [ ] `initDashboard()` の `historyBtn.click()` を registry 経由に置換
- [ ] `npm run validate` が成功する

### Phase 4
- [ ] `entrypoints/options/main.ts` の import を1本化
- [ ] `dashboard.ts` を削除
- [ ] 既存の dashboard.ts 関連テストを移動先に合わせて更新
- [ ] `npm run validate` が成功する

## テスト戦略

### 単体テスト（新規）
- `markdownExport`: バッチ分割（desktop 1000 / mobile 500）、日付バケット、テンプレート適用
- `generalSettingsPanel`: 設定の読み込み・保存・各ハンドラ

### 回帰テスト
- `src/dashboard/__tests__/` の55ファイル（とくに `dashboard-handlers.test.ts`）
- E2E: Dashboard を開く Playwright テスト（`make test` に含まれる）

### E2E が重要
初期化経路の変更は単体テストで検出しきれない。**Phase 4 の後は必ず E2E を通す**こと。

## 実装アプローチ

Phase 1 → 2 → 3 → 4 の順。**各 Phase で `npm run validate` を通し、コミットを分ける**。

Phase 4 は最も危険（初期化経路の切り替え）なので、その前に Phase 1-3 が安定していることを確認する。

## 見積もり
3pt以上（4 Phase。各 Phase が 1pt 相当）

## 技術的考慮事項

- **副作用🔴あり**: Dashboard の初期化経路を変える。全設定画面が影響を受ける
- `entrypoints/options/index.html` は**2255行**あり、全パネルの markup が静的に存在する。そのため多くのパネルは `mount(container)` の引数を無視して `document.getElementById` で要素を探している。この構造自体は本PBIの範囲外（HTML の分割は別問題）
- `dashboard.ts` には55ファイルのテストのうち複数が依存している。Phase 4 で削除する際、テストの移動先を決める必要がある
- PBI `2026-08-08-03`（Panel 契約整理）で `navigateTyped` を採用してから Phase 3 に入るのが自然。**実施順序に依存関係がある**
- `initDashboard` は過去に名前衝突のバグがあった（commit `f43c749`）。触る際は注意

## 関連

- アーキテクチャレビュー（2026-08-08）候補1
- ADR: `dev-docs/ADR/2026-07-13-architecture-phase2-deep-dig.md` #1（「抽象定義を先に行う」→ 抽象は定義されたが旧実装が残った）
- 依存PBI: `2026-08-08-03-refactor-panel-contract-cleanup.md`（`navigateTyped` の採用が Phase 3 の前提）
- 先行修正: commit `f43c749`（`initDashboard` 名前衝突）
- 対象: `entrypoints/options/main.ts`, `src/dashboard/dashboard.ts`, `src/dashboard/panels/staticForm/generalSettingsPanel.ts`
