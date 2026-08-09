# PBI: 転送するだけの StaticFormPanel 9件を宣言表に置き換える

**作成日**: 2026-08-09
**優先度**: 低
**見積もり**: 🟢小（2pt目安）
**副作用**: 🟢なし（内部構造のみ。UI・設定・storage に変更なし）
**種別**: ♻️リファクタリング（refactor）

---

## フェーズ0: 既実装確認（実施済み・2026-08-09）

```bash
# 汎用アダプタは既にあるか
grep -rn "createStaticFormPanel\|defineStaticPanel" src/dashboard
# → 出力なし。未実装であることを確認

# これらのパネルにテストはあるか
ls src/dashboard/panels/staticForm/__tests__/
# → privacySettingsPanel.test.ts のみ。対象9件にテストは存在しない
```

---

## 背景

アーキテクチャレビュー（2026-08-09、候補04）で、
**中身が「既存の init 関数を呼ぶだけ」のパネルモジュールが9件**あることが判明した。

### 対象9件（実測）

| ファイル | 行数 | 実質的な中身 |
|---|---|---|
| `tagsSettingsPanel.ts` | 12 | `await initTagsPanel()` |
| `recordingConditionsPanel.ts` | 12 | `await initRecordingConditionsSettings()` |
| `promptSettingsPanel.ts` | 14 | `initCustomPromptManager(settings)` |
| `markdownTemplatePanel.ts` | 14 | `initMarkdownTemplateManager(settings)` |
| `cspSettingsPanel.ts` | 15 | `CSPSettings.loadCSPSettings()` |
| `contentSettingsPanel.ts` | 16 | `initContentSettings()` / `loadContentSettings()` |
| `exportImportPanel.ts` | 16 | 3つの init を順に呼ぶ |
| `trustSettingsPanel.ts` | 16 | `initTrustSettings()` / `loadTrustSettings()` |
| `domainFilterPanel.ts` | 18 | `initDomainFilter()` / `initDomainFilterTagUI()` |

**合計133行、9ファイル。** すべて `import` + ファクトリ + 転送のみ。

```typescript
// tagsSettingsPanel.ts の全内容
import { type StaticFormPanel } from '../types.js';
import { initTagsPanel } from '../../tagsPanel.js';

export function createTagsSettingsPanel(): StaticFormPanel {
  return {
    id: 'panel-tags',
    category: 'static-form',
    async mount(_container) { await initTagsPanel(); },
  };
}
```

### なぜこれが問題か（deletion test）

**インターフェース（ファクトリ関数 + 3〜4プロパティのオブジェクト）が、
実装（1行の関数呼び出し）より大きい。** = 浅いモジュール。

`_container` 引数に注目すると構造が見える。
`StaticFormPanel` 契約が提供する `container` を、**9件中7件が使っていない**
（`_` 接頭辞がそれを示している）。
ラップ先の init 関数が `document.getElementById` で自分で DOM を取りに行くため、
**seam が宣言されているだけで機能していない。**

### なぜなぜ分析

**なぜ1**: なぜ1行のためにファイルがあるのか
→ `NavigationRegistry.register()` が `Panel` 型のオブジェクトを要求するから。

**なぜ2**: なぜオブジェクトが必要なのか
→ パネルごとに `mount` / `refresh` / `onActivate` の有無が異なり、
契約で表現するのが自然だったから。

**なぜ3**: では9件はなぜ同じ形なのか
→ **実際には「id と初期化関数」しか差が無いから。**
契約の表現力（3種のライフサイクル）が、この9件には過剰。

**なぜ4**: なぜ過剰な契約に合わせているのか
→ `generalSettingsPanel`（205行）や `sqliteHistoryPanel`（1118行）のような
**本当に契約が必要なパネルと同じ扱い**にしているから。

**なぜ5（根本）**
**「パネルである」という1つの概念に対して、
複雑さの異なる2種類（自己完結型 / 単純委譲型）が混在しているのに、
表現手段が1つしか無いから。**

### deletion test の判定

| 対象 | 削除したら | 判定 |
|---|---|---|
| 対象9件 | 宣言表の9行に**集約**される | ✅ PASS |
| `generalSettingsPanel`（205行） | `main.ts` に205行が**散らばる** | ❌ FAIL（残す） |
| `privacySettingsPanel`（95行） | 同上 | ❌ FAIL（残す） |
| `aiSummaryCleansingPanel`（66行） | スライダー処理が散らばる | ❌ FAIL（残す） |

---

## ユーザーストーリー

**開発者（特に本コードベースに不慣れな者・AIエージェント）**として、
**設定パネルの一覧を1画面で把握できる状態**がほしい、
なぜなら**現在は「どんな設定パネルがあるか」を知るのに9ファイルを開く必要があり、
その9ファイルには開くだけの情報が入っていないから**。

## ビジネス価値

- **ナビゲーションコストの低減**: パネル構成の把握が9ファイル → 1表。
  AIエージェントが繰り返し支払うコストとして効いてくる。
- **追加コストの低減**: 単純な設定パネルの追加が「新規ファイル作成」→「1行追加」。
- **測定方法**: `src/dashboard/panels/staticForm/` のファイル数（12 → 3）。

> **注**: 本PBIは行数削減が主目的ではない（133行と小さい）。
> **「パネル一覧が一望できる」という可読性**が主目的。

---

## BDD受け入れシナリオ

```gherkin
Scenario: パネル一覧が1箇所で読める
  Given 単純委譲型のパネルが宣言表にまとめられている
  When 開発者が「どんな設定パネルがあるか」を知りたい
  Then 1つの表を読むだけで9件すべてのidと初期化処理が分かる

Scenario: 既存のパネル動作が変わらない
  Given 利用者が設定画面のタグ設定タブを開く
  When パネルが表示される
  Then リファクタリング前と同一の内容が表示される

Scenario: refresh を持つパネルの動作が保たれる
  Given trustSettings / contentSettings / cspSettings / domainFilter は refresh を持つ
  When refresh が呼ばれる
  Then それぞれ対応する load 関数が実行される

Scenario: 複雑なパネルは影響を受けない
  Given generalSettingsPanel は205行の固有処理を持つ
  When リファクタリングを行う
  Then generalSettingsPanel は独立したファイルのまま残る
```

---

## 受け入れ基準

- [ ] 対象9ファイルが削除され、宣言表に集約されている
- [ ] `generalSettingsPanel` / `privacySettingsPanel` / `aiSummaryCleansingPanel` は**残っている**
- [ ] `refresh` を持つ4件（trust / content / csp / domainFilter）の動作が保たれている
- [ ] `mount` が `settings` を必要とする2件（prompt / markdownTemplate）が動作する
- [ ] アダプタに単体テストがあり、9件すべての形を1つのテストで検証している
- [ ] `npm run validate` が通る
- [ ] `npm run build` が通り、options 画面が全パネル正常に開く（手動確認）

---

## テスト戦略（t_wadaスタイル / Outside-In）

### E2Eテスト（最小限）
- options 画面で各設定タブを開き、内容が表示される（既存E2Eがあれば流用）

### 統合テスト（中程度）
1. `NavigationRegistry` に宣言表から生成したパネルを登録し、`navigate()` で `mount` が呼ばれる
2. `refresh` を持つパネルで `refresh()` が対応する load 関数を呼ぶ

### 単体テスト（多数）
1. アダプタが `id` / `category: 'static-form'` を正しく設定する
2. `mount` が指定した init 関数を呼ぶ
3. `refresh` 未指定なら `refresh` プロパティが**存在しない**
   （`StaticFormPanel.refresh` は optional。空実装を作らない — PBI 2026-08-08-03 の決定）
4. 非同期 init（`initTagsPanel`）と同期 init（`initContentSettings`）の両方が扱える
5. `settings` を要求する init（`initCustomPromptManager`）が扱える

### Outside-In の進め方
1. アダプタのテストを書く（Red）
2. アダプタを実装（Green）
3. 9件を1件ずつ表へ移す。**1件移すごとに `npm run validate`**

---

## 実装アプローチ

詳細な手順は実装計画を参照:
`dev-docs/plans/2026-08-09-pbi22-shallow-static-form-panels-plan.md`

---

## 見積もり

🟢小（2pt目安）— 対象9ファイル・133行。テストが存在しないため回帰リスクは手動確認に依存する点に注意。

---

## 技術的考慮事項

### 依存関係
- `NavigationRegistry` / `StaticFormPanel` 契約は変更しない
- PBI 2026-08-08-03（`refresh` の optional 化）の決定を踏襲する
- **PBI 2026-08-08-09（dual bootstrap）と競合しない**:
  あちらは `generalSettingsPanel` と `dashboard.ts` の関係が対象。本PBIは対象外の9件

### テスタビリティ
現状これら9件には**テストが1件も存在しない**。
アダプタ化により、9件分の形を1つのテストで担保できるようになる（正味の改善）。

### 非機能要件
- **性能**: 影響なし（起動時のパネル生成は同じ回数）
- **後方互換**: パネル `id` 文字列は**変更禁止**（HTML の `data-panel` 属性と対応）

---

## 実装者向け注記

### 着手前に必ず実行

```bash
# 対象9件の中身を一度に確認する（全部で133行しかない）
cat src/dashboard/panels/staticForm/{tags,recordingConditions,prompt,markdownTemplate,csp,content,exportImport,trust,domainFilter}*.ts

# 登録側を確認する
cat src/dashboard/main.ts

# パネルidとHTMLの対応を確認する（idは変更禁止）
grep -o 'data-panel="[^"]*"' entrypoints/options/index.html | sort -u
```

### 落とし穴: init 関数のシグネチャが揃っていない

**調査済みの実態:**

| init 関数 | 同期/非同期 | 引数 |
|---|---|---|
| `initTagsPanel` | **async** | なし |
| `initRecordingConditionsSettings` | **async** | なし |
| `initGistSettings` | **async** | なし |
| `CSPSettings.loadCSPSettings` | **async** | なし |
| `initCustomPromptManager` | 同期 | **`settings: Settings`** |
| `initMarkdownTemplateManager` | 同期 | **`settings: Settings`** |
| `initContentSettings` / `initDomainFilter` / `initTrustSettings` | 同期 | なし |
| `initExportImport` / `initEncryptedBackupPanel` | 同期 | なし |

**アダプタは「`settings` を要る／要らない」「同期／非同期」の両方を吸収する必要がある。**
`mount` 側を常に `async` にして `await` すれば同期/非同期は吸収できる（`await` は非Promiseも扱える）。
`settings` は「必要な場合だけ `getSettings()` を呼ぶ」形にする（不要なパネルで無駄な読み込みをしない）。

### 落とし穴: `exportImportPanel` は3つ呼ぶ

```typescript
initExportImport();
initEncryptedBackupPanel();
await initGistSettings();
```

1関数1パネルの前提で表を設計すると、この1件が入らない。
**`init` を配列で受けるか、関数1つにまとめて渡せる形**にすること。

### 落とし穴: `domainFilterPanel` は mount と refresh で別関数

```typescript
async mount(_container) { initDomainFilter(); await initDomainFilterTagUI(); },
async refresh() { await loadDomainSettings(); },   // ← mount とは別の関数
```

`trustSettingsPanel` / `contentSettingsPanel` も同様に mount と refresh で呼ぶ関数が違う。
**「refresh は mount と同じ処理」と決め打ちしない。**

### 落とし穴: `refresh` の空実装を作らない

PBI 2026-08-08-03 で「`refresh` は optional。持たないパネルは宣言しない」と決定済み。
アダプタが常に `refresh` を生やすと、この決定に反する。
**`refresh` が未指定なら、プロパティ自体を生やさないこと。**

### 落とし穴: パネル id は HTML と結合している

`id: 'panel-tags'` は `entrypoints/options/index.html` の
`<div id="panel-tags">` と `data-panel="panel-tags"` に対応する。
**表に移す際に id をタイプミスすると、そのパネルだけ無言で開かなくなる**
（`NavigationRegistry.navigate()` が throw するが、
`DashboardBootstrapper.wireSidebar` が catch している — 57行目）。

→ **全パネルidが HTML に存在することを検証するテストを追加すると安全。**

### 落とし穴: テストが無いので手動確認が必須

対象9件にテストが1件も無いため、自動テストだけでは回帰を検出できない。
`npm run build` 後、Chrome で options 画面を開き、
**9つのタブすべてを実際にクリックして内容が表示されることを確認する。**

---

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] アダプタの単体テストが追加されている
- [ ] パネルidとHTMLの対応を検証するテストが追加されている
- [ ] `npm run validate` / `npm run build` が通る
- [ ] **手動確認**: options 画面で9タブすべてを開いて表示を確認
- [ ] コードレビュー完了

---

## 関連

- アーキテクチャレビュー 2026-08-09（候補04）
- PBI 2026-08-08-03（Panel 契約の整理・`refresh` optional 化）— 決定を踏襲する
- PBI 2026-08-08-09（dual bootstrap）— 対象が異なるため競合しない
