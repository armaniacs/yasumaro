# PBI: Panel 抽象から死んだメンバを削り、契約を実態に合わせる

**作成日**: 2026-08-08
**優先度**: 中
**見積もり**: 🟢低（1pt目安）
**副作用**: 🟢なし（未使用メンバの削除。振る舞い不変）
**種別**: 🔧非機能追加（refactor）

---

## 背景

アーキテクチャレビュー（2026-08-08、候補3）で、Panel 抽象（ADR 2026-07-13 #1 の成果物）が**実態より広い契約を要求している**ことが判明した。

| 事実（実測） | 影響 |
|---|---|
| `refresh()` の呼び出しは `src/` 全体で**0件**。`StaticFormPanel`・`DiagnosticPanel` が必須要求 | 5パネルが `async refresh() {}` と空実装を書いて契約を満たしている |
| `NavigationRegistry` が判別共用体を**キャストで剥がす**（30・36・56・59行の `panel as {...}`） | `category` による narrowing が効いていない |
| `navigateTyped` / `PanelInitMap` は定義のみ。実際の遷移は untyped の `navigate()` | 型付き遷移という設計意図が未達 |
| `auditLogPanel.ts` は `id`/`category`/`mount` を持たず `types.ts` も import せず `main.ts` に未登録 | 実体は TSV フォーマッタ。`panels/asyncData/` にある理由がない |
| `registryContext.ts` が `let _registry` の可変モジュールグローバル | パネルが注入依存ではなくグローバルに結合 |

### 検証コマンド（実測済み）

```bash
grep -rn "\.refresh()" src/ | grep -v __tests__   # → 0件
```

### 削除テスト

`refresh()` を interface から削除すると、移動先が無い（誰も呼んでいない）→ **複雑度は純減**。deletion test が最も明快に通るケース。

`registryContext.ts` は「パネル間遷移」という実需があるため削除しない（複雑度が呼び出し元へ移動するだけ）。本PBIでは触らない。

---

## 実装者向け注記: 現状の確認

```bash
# refresh() の空実装を持つパネル
grep -rn "async refresh()" src/dashboard/panels/

# NavigationRegistry のキャスト箇所
grep -n "panel as\|current as" src/dashboard/panels/NavigationRegistry.ts

# navigateTyped の呼び出し元
grep -rn "navigateTyped" src/ | grep -v __tests__

# auditLogPanel の参照元
grep -rn "auditLogPanel" src/ | grep -v __tests__
```

---

## 設計

### Before / After（契約の幅）

```
Before                          After
─────────────────────────       ─────────────────────────
mount()        ← 使用           mount()        ← 使用
loadData()     ← 使用           loadData()     ← 使用
onActivate()   ← 使用           onActivate()   ← 使用
onDeactivate() ← 使用           onDeactivate() ← 使用
refresh()      ← 呼び出し0件
navigateTyped  ← 未使用

空実装: 5件                     空実装: 0件
キャスト: 4箇所                 category で narrowing
```

### 対応方針

| 対象 | 方針 |
|---|---|
| `refresh()` | `StaticFormPanel` / `DiagnosticPanel` から削除。5件の空実装も削除。**実装のある `refresh()` は残す**（後述） |
| `NavigationRegistry` のキャスト | `switch (panel.category)` による narrowing に置換 |
| `navigateTyped` / `PanelInitMap` | 実際の遷移経路で採用する（型付きの意図を活かす方向。削除ではなく利用） |
| `auditLogPanel.ts` | `src/dashboard/utils/auditLogTsv.ts` へ移動し実態に合わせて改名 |
| `registryContext.ts` | 本PBIでは変更しない（実需あり） |

**注意**: `refresh()` に実体のある実装（`diagnosticsPanel` 等）がある場合、そのメソッド自体は残し、**interface の必須要求から外す**（optional にするか、呼ぶ側が具体型を知る形にする）。実装を消すと機能が壊れるため、実装時に各 `refresh()` の中身を確認すること。

---

## 受け入れ基準（BDD）

```gherkin
Scenario: 空実装の refresh() が消える
  Given refresh() の呼び出しが src 全体で0件である
  When interface から必須要求を外す
  Then 空実装 async refresh() {} を持つパネルが0件になる

Scenario: NavigationRegistry が型で narrowing する
  Given Panel が category による判別共用体である
  When NavigationRegistry がパネルを扱う
  Then panel as {...} のキャストを使わずに型が絞られる

Scenario: auditLogPanel が実態に合った場所に移る
  Given auditLogPanel.ts は Panel を実装していない TSV フォーマッタである
  When utils へ移動する
  Then panels/ 配下は Panel 実装のみになる

Scenario: 既存テストが全てパスする
  When 変更を完了する
  Then npm run validate が成功する
```

## 受け入れ基準

- [ ] `refresh()` を `StaticFormPanel` / `DiagnosticPanel` の必須要求から外す
- [ ] 空実装の `async refresh() {}` を削除（実体のある実装は保持）
- [ ] `NavigationRegistry` のキャスト4箇所を `category` narrowing に置換
- [ ] `navigateTyped` を実遷移経路で採用（または未採用の理由をPBIに記録）
- [ ] `auditLogPanel.ts` を `src/dashboard/utils/` へ移動・改名
- [ ] `NavigationRegistry` の narrowing を検証する単体テストを追加
- [ ] `npm run validate` が成功する

## テスト戦略

### 単体テスト
- `NavigationRegistry`: 各 category のパネルで `mount` / `loadData` / `onActivate` / `onDeactivate` が正しく呼ばれること（既存 `NavigationRegistry.test.ts` 144行を拡張）
- 移動後の `auditLogTsv`: 既存の TSV エスケープテストを維持

### 回帰テスト
- 既存 `DashboardBootstrapper.test.ts`

## 実装アプローチ

1. 各 `refresh()` の中身を確認し、実体のあるものを特定
2. interface から必須要求を外す
3. 空実装を削除
4. `NavigationRegistry` を narrowing に書き換え
5. `auditLogPanel.ts` を移動
6. `npm run validate`

## 見積もり
1pt（interface 変更 + 空実装削除 + registry 書き換え + 1ファイル移動）

## 技術的考慮事項

- `panels/` 配下は約2900行に対しテスト7ファイル859行。契約が縮めばテストすべき面も明確になる
- `mount(container)` が9パネルで `_container` と未使用なのは、markup が `entrypoints/options/index.html`（2255行）に静的に存在するため。これは本PBIの範囲外（候補1で扱う）
- `auditLogPanel.ts` 移動時は `manifest.json` の `web_accessible_resources` を確認（`src/dashboard/` は content script から動的 import されないため通常は不要だが要確認）

## 関連

- アーキテクチャレビュー（2026-08-08）候補3
- ADR: `dev-docs/ADR/2026-07-13-architecture-phase2-deep-dig.md` #1（Panel 抽象の定義。本PBIはその後始末）
- 対象: `src/dashboard/panels/types.ts`, `NavigationRegistry.ts`, `asyncData/auditLogPanel.ts`, `staticForm/*.ts`
