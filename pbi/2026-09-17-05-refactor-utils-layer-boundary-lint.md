# PBI: src/utils/ の層境界を lint で強制する

優先度: 順位 4 / 10（RICE: 4.27 = Reach 8 / Impact 2 / Confidence 0.8 / Effort 3 pt）
backlog: [2026-09-17-00-backlog-arch-review-0917.md](2026-09-17-00-backlog-arch-review-0917.md)（台帳）
依存: なし

## ユーザーストーリー

拡張機能を保守する開発者として、`src/utils/` の層定義（Layer 0 / 1 / 1-循環 / 2 / Barrel）に違反するコードを書いたら lint で自動的に検出してほしい、なぜなら現状は違反の発見が人力レビュー頼みで、utils 配下の規模では見逃しが避けられないから。

---

## 背景（現状と課題）

`dev-docs/LAYERS.md` が `src/utils/` の層構造を形式化している（Layer 0 = Foundation・pure、Layer 1 = Infrastructure・chrome.storage 等、Layer 1-循環 = ADR 記録済みの例外、Layer 2 = High-level Utilities、Barrel = 再エクスポート層）。しかし機械検査がなく、違反は人力で発見される。

実在した逸脱の例として、`src/utils/storage.ts`（Barrel）は `trancoConsentManager` の dynamic import（実行時に `../storage.js` を `await import()` する意図的設計）のため削除できず、その経緯がファイルヘッダーと ADR（2026-08-20-utils-layer-circular-dependency）に記録されている。将来のリファクタで「なぜこんな複雑な import なのか」と除去されるリスクが ADR に明記されている。

規模の問題もある。utils 配下は約120モジュールに達し、48ファイルが `chrome.*` を直接参照する（多くは Layer 1 として正当だが、分類自体が人力判断）。循環回避の dynamic import も複数箇所に存在する（`settingsStore` と `trustDb` の相互参照、`trancoConsentManager` から `settingsStore` への遅延参照、`storageMaintenance` から `background/sqliteClient` への遅延参照）。

一方で土台はある。`eslint/` ディレクトリにカスタムプラグイン（`plugin.mjs` が `rules/` 配下の3ルール — `require-sanitized-markdown`、`require-response-size-limit`、`no-tautology-expect` — を束ねる構成）と `__tests__/` 配下の RuleTester によるテスト慣習が既にある。また `eslint.config.js` では `no-restricted-imports` による Barrel（`storage.js`・`logger.js`）の新規利用抑制と、`src/background/` から UI 層（popup/dashboard）への上向き依存禁止が既に warn レベルで動いている。本 PBI はこの流れを層境界全体に広げる。

対応方針は、LAYERS.md の層定義を機械検査に落とすこと。Layer 0 は外部依存禁止（chrome 参照禁止・Layer 2 参照禁止）、Layer 1 は Layer 0 のみ import 可、Barrel からの新規 import 抑制等をルール化する。実装は既存カスタムプラグインへのルール追加か `eslint-plugin-boundaries` の導入かを判断し、理由を本 PBI に記録する。既存コードでルールに抵触する箇所は (a) コード側で是正するか (b) LAYERS.md の分類を現実に合わせて訂正＋ADR 記録するかを個別に判断し、その判断記録を本 PBI に残す。

スコープ外（台帳へ戻す）: 物理的な再階層化（ディレクトリ移動）。本 PBI は「境界の機械化と違反阻止」のみを扱う。

---

## BDD受け入れシナリオ

```gherkin
Scenario: Layer 0 での chrome 参照は lint 違反になる
  Given Layer 0（Foundation・pure）に分類されるモジュール
  When  chrome.* を参照するコードを書く
  Then  lint が層境界違反として報告する

Scenario: ADR 記録済みの循環例外は lint が通る
  Given ADR 記録済みの Layer 1-循環例外（settingsStore と trustDb の相互参照など）
  When  循環回避のための dynamic import（await import）を使う
  Then  許可リストにより lint が通る

Scenario: Layer 1 から Layer 2 への import は lint 違反になる
  Given Layer 1（Infrastructure）に分類されるモジュール
  When  Layer 2（High-level Utilities）のモジュールを静的に import するコードを書く
  Then  lint が層境界違反として報告する
```

## 受け入れ基準

- [ ] Layer 0 の chrome 参照禁止・Layer 2 参照禁止が lint で検出される
- [ ] Layer 1 の Layer 0 以外への静的 import が lint で検出される
- [ ] ADR 記録済みの Layer 1-循環例外（dynamic import による回避）が許可リストで lint を通過する
- [ ] Barrel からの新規 import 抑制の方針が確定している（既存 `no-restricted-imports` の warn 維持・強化・新ルール統合のいずれかを明示）
- [ ] 実装方式（既存カスタムプラグインへのルール追加 vs `eslint-plugin-boundaries`）の選択と理由が本 PBI に記録されている
- [ ] 既存コードの抵触箇所について (a) コード是正／(b) 分類訂正＋ADR の判断が一件ごとに記録されている
- [ ] `npm run lint` が green（新規ルール適用後の既存違反は是正・許可リスト・warn のいずれかで処理済み）
- [ ] 物理的なディレクトリ移動を行っていない（スコープ外の再階層化に着手していない）

## テスト戦略

- eslint カスタムルールは `eslint/__tests__/` の慣習に従い、RuleTester でテストする（既存の `require-sanitized-markdown.test.ts` の valid／invalid 両持ちの形式を参照）
- 違反パターン（Layer 0 の chrome 参照、Layer 1 の Layer 2 参照）と許可パターン（ADR 記録済み例外の dynamic import、Layer 内の正当な参照）の双方をテストケースとして pin する
- 新規ルール追加時は `npm run lint` 全体が green であることを確認し、既存ルールのテストが壊れていないことを確認する
- `eslint-plugin-boundaries` を採用した場合は、その設定自体をテストで固定する（設定の意図しない緩和を検出できること）

## 見積もり

3pt（2〜3日程度）。既存違反の量によっては (a)／(b) 判断作業が膨らむため、初回スキャンで抵触件数を見積もってから着手すること。

---

## 実装ガイド（着手時の調査・設計手順）

### 確認ポイント（着手前に読む）

- `dev-docs/LAYERS.md` 全体（層定義・ファイル分類・依存ルール・違反検出の grep 例・新規配置チェックリスト）
- `eslint/plugin.mjs` と `rules/` 配下の既存ルール構成（`create(context)` の `ImportDeclaration` フックの書き方が参考になる）
- `eslint/__tests__/` の RuleTester の書き方（valid／invalid 両持ち、`name`＋`code` 形式）
- `src/utils/storage.ts` のファイルヘッダー（Barrel 残置理由と `trancoConsentManager` の dynamic import の経緯）
- ADR 2026-08-20-utils-layer-circular-dependency（循環 1〜3 の内訳と「削除不可」の決定）

### ルール設計案

- 層の判定ソースは LAYERS.md のファイル分類表を起点とし、`// @layer N` コメント（LAYERS.md の新規配置チェックリストで付与が求められている）との二重管理にならないよう、どちらを正とするか決める
- Layer 0 違反の検出対象: `chrome.*` への参照（`MemberExpression` の `chrome` オブジェクト検出が既存ルールの `CallExpression`／`TemplateLiteral` フックと同様の AST 走査で書ける）、Layer 2 モジュールへの静的 import
- Layer 1 違反の検出対象: Layer 0 以外への静的 `ImportDeclaration`（dynamic import は対象外とし、循環例外の回避手法と区別する）
- 許可リスト: ADR 記録済みの例外のみ（`settingsStore` と `trustDb` の相互 dynamic import、`trancoConsentManager` の `storage`／`settingsStore` への dynamic import、`storageMaintenance` の `background/sqliteClient` への dynamic import）。許可リストへの追加は ADR 記録を必須条件にする
- Barrel 新規 import 抑制は `eslint.config.js` の既存 `no-restricted-imports`（warn）がカバーしているため、新ルールと二重化せず、レベル（warn→error）変更の要否だけ判断する

### 既存違反の調査手順

LAYERS.md の「違反検出」節の grep 例を起点に初回スキャンする：

- `@layer` コメントの付与状況確認
- Layer 0 ファイル群からの `storage` 参照の有無
- 循環 import が dynamic import であることの確認（`settingsStore`・`trustDb` 付近）
- `background` から UI 層への上向き import の有無

抵触が見つかったら一件ごとに以下を記録する：

```
- 箇所: <ファイル名の関数・クラス付近>
  判断: (a) コード是正 ／ (b) 分類訂正＋ADR
  理由: <なぜその判断か>
```

(b) を選ぶ場合は LAYERS.md の分類表を現実に合わせて訂正し、ADR に記録してから許可リストに入れる（分類表の訂正なしに許可リストへ追加しない）。

### 実装方式の判断観点

- 既存カスタムプラグインへの追加: 依存ゼロ、`@layer` コメントや LAYERS.md 分類表などプロジェクト固有の正本に合わせた判定が書ける。反面、import グラフ全体の可視化は自前になる
- `eslint-plugin-boundaries`: 層境界検査の専用プラグインで宣言的に書ける。反面、新規依存の追加と、Layer 1-循環のような例外的 dynamic import 許可の表現可否を検証する必要がある
- いずれを選んでも、選定理由（上記の観点での比較結果）を本 PBI の受け入れ基準「実装方式の選択と理由」に残すこと

---

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
- [ ] 既存コードの抵触箇所の (a)／(b) 判断記録が本 PBI に残っている
