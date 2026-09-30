# PBI: クラスタグラフ描画の renderTagGraph 抽出

## ユーザーストーリー

保守者として、SVG クラスタグラフ描画を 1 関数に抽出したい。なぜなら 3 パネルが約 60 行の描画骨格を逐語複製し、`MAX_NODES` 等の定数も 3 重に再宣言されているからだ。

## ビジネス価値

- 3 パネルの描画骨格（約 60 行）の逐語複製を解消し、SVG 出力の変更が 1 箇所で済むようにする。
- `MAX_NODES` と `SVG_NS` の重複宣言を 1 箇所にまとめ、上限値がずれた場合の切り分けを不要にする。
- 既存台帳（`pbi/2026-09-24-00-backlog-archloop-0924.md`）のトリガー「3つ目のクラスタグラフ系パネルを追加する時」は既に発火済みであり、本 PBI によって待機台帳の滞留を解消する。
- パネルごとの意図的な差（単色 vs 色分け、node class の違い）は維持したまま、共通骨格だけを共有する。

## 優先度

- 種別: refactor
- 順位: 17 / 17
- RICEスコア: 2.0（Reach=2 / Impact=1 / Confidence=100% / Effort=1 SP）

## BDD受け入れシナリオ（gherkin、Scenario 2件以上）

```gherkin
Scenario: 3 パネルの SVG 描画が共通関数に集約される
  Given 3 つのクラスタグラフ系パネルが同一の描画骨格を逐語複製している
  When 共通レンダラへ抽出する
  Then 3 パネルの描画が 1 つの関数と 1 つの定数モジュールから供給される
  And MAX_NODES と SVG_NS の宣言が 1 箇所に集約される

Scenario: パネルごとの意図的な差が維持される
  Given 単体 2 パネルは全ノード同色で compare パネルは --tag-hue で色分けしている
  And circle の class は単体パネルと compare パネルで異なる
  When 共通レンダラへ抽出する
  Then 見た目の差（色分けと node class）は現行パネルごとの差が維持される
  And aria-label の文言差も変更されない

Scenario: 抽出後も 3 パネルの SVG 出力が不変である
  Given 抽出前の 3 パネルの SVG 出力が観測されている
  When 共通レンダラへ抽出して同じ入力を渡す
  Then 各パネルの SVG 出力が抽出前と一致する
  And ノード上限と row-cap メッセージの挙動が同一である
```

## 受け入れ基準

- [x] 共通レンダラが `src/dashboard/panels/asyncData/clusterGraphRenderer.ts` として作成されている。
- [x] `limitToTopNodes` → `computeCanvasSize` → `computeLayout` → edge line → node circle + title + text → `role="img"` / `aria-label` → `TagClusterPanZoomController.attach` の骨格が共通レンダラに集約されている。
- [x] `src/dashboard/panels/asyncData/tagClusterPanel.ts:121-194`、`src/dashboard/panels/asyncData/wordClusterPanel.ts:168-239`、`src/dashboard/panels/asyncData/tagClusterTimeSliderPanel.ts:224-297` の 3 箇所が共通レンダラの呼び出しに置き換わっている。
- [x] `MAX_NODES = 50` の宣言が 1 箇所に集約され、`src/dashboard/panels/asyncData/tagClusterPanel.ts:33`、`src/dashboard/panels/asyncData/wordClusterPanel.ts:45`、`src/dashboard/panels/asyncData/tagClusterTimeSliderPanel.ts:48` の 3 重宣言が解消されている。
- [x] `SVG_NS` の宣言が 1 箇所に集約され、`src/dashboard/panels/asyncData/tagClusterLoading.ts:15` を含む production 4 ファイルが共通定数を参照している。
- [x] 差分はオプション（`nodeClassName` / `hueByRelativeSize` / `ariaLabel` 組立）で吸収されている。
- [x] 見た目は現状のまま維持されている。具体的には、`--tag-hue` を設定するのは比較パネルのみ（`src/dashboard/panels/asyncData/tagClusterTimeSliderPanel.ts:252`）で、単体 2 パネルは全ノード同色である。
- [x] circle の class の差（単体 `tag-cluster-node` / 比較 `tag-cluster-node tag-cluster-compare-node`）が維持されている。
- [x] row-cap メッセージの共通化により、`src/dashboard/panels/asyncData/wordClusterPanel.ts:103-110` と `src/dashboard/panels/asyncData/tagClusterTimeSliderPanel.ts:152-162` の同形 2 箇所が 1 箇所に集約されている。
- [x] `notices.show('truncated')` / `hide` の 3 連（3 パネルの各 3 箇所）が共通化されている。
- [x] `npm run validate` が成功し、既存のビルド・テストに回帰がない。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 外部からは「3 パネルのクラスタグラフが従来と同じ図形で表示される」という観測点を確認する。
- 新しいユーザー機能は追加せず、描画の見た目と操作（pan / zoom）が変更されないことを Outside-In の観測点とする。
- 比較パネル（time slider）の色分けと単体パネルの単色が維持されていることを観測する。

### 統合テスト

- 共通レンダラが pan / zoom のコンテナへ attach された後、3 パネルそれぞれで操作が従来どおり機能することを検証する。
- ノード上限（`MAX_NODES`）を超えた場合に `notices.show('truncated')` → 描画 → `hide` の 3 連が 3 パネルとも同一の順序で発生することを検証する。
- row-cap 到達時のメッセージが 3 パネルで同一の文言・同一の表示契機になることを検証する。
- 抽出前後の SVG 出力を 3 パネルで比較し、parity を検証する。

### 単体テスト

- 共通レンダラ単体の SVG 出力を pin し、`role="img"` と `aria-label` の組み立てが現状の文言と一致することを検証する。
- `nodeClassName` オプションが単体パネル（`tag-cluster-node`）と比較パネル（`tag-cluster-node tag-cluster-compare-node`）の class を正しく分けることを検証する。
- `hueByRelativeSize` オプションが true のときのみ相対サイズに応じた色分けが出力され、false のとき単色であることを検証する。
- `limitToTopNodes` が共通化され、上限が 1 箇所の定数で決まることを pin する。
- 過剰な golden テストは追加しない。既存の表示テストがあれば維持し、無ければ最小限の pin とする。

## 実装アプローチ

- **Outside-In**: まず「3 パネルの SVG 出力が同一の骨格から生成される」という観測点を failing として用意し、共通レンダラの作成で green にする。
- **骨格の抽出のみ**: 挙動を変えずに逐語複製だけを共通関数へ移す。ロジックの整理や最適化は同時に行わない。
- **差分はオプションで吸収**: `nodeClassName` / `hueByRelativeSize` / `ariaLabel` 組立の 3 つのオプションで吸収できると見込み、それ以外の差が出た場合は共通化を見送る。
- **定数の 1 箇所化**: `MAX_NODES` と `SVG_NS` は共通定数モジュールに置き、3 パネルの個別宣言を撤去する。
- **過剰テストの回避**: 抽出は形状の話であり、振る舞いは変えない。parity 検証と最小限の pin に留める。

## 見積もり

**1 SP**

共通レンダラの作成（描画骨格約 60 行の移設とオプション設計）0.5 SP、3 パネルの置き換えと定数の 1 箇所化 0.25 SP、row-cap メッセージと `notices` の 3 連の共通化 0.15 SP、SVG parity の確認 0.1 SP が内訳である。

## 技術的考慮事項

- 本 PBI は既存台帳 `pbi/2026-09-24-00-backlog-archloop-0924.md` の「renderTagGraph 抽出」（RICE 0.8・1pt）からの昇格である。トリガーは「3つ目のクラスタグラフ系パネルを追加する時」で、`src/dashboard/panels/asyncData/wordClusterPanel.ts` と `src/dashboard/panels/asyncData/tagClusterTimeSliderPanel.ts` が第 2・第 3 実装として既に存在するため発火済みである。
- 3 重複している描画骨格は `src/dashboard/panels/asyncData/tagClusterPanel.ts:121-194`、`src/dashboard/panels/asyncData/wordClusterPanel.ts:168-239`、`src/dashboard/panels/asyncData/tagClusterTimeSliderPanel.ts:224-297` である。骨格は `limitToTopNodes` → `computeCanvasSize` → `computeLayout` → edge line → node circle + title + text → `role="img"` / `aria-label` → `TagClusterPanZoomController.attach` である。
- `MAX_NODES = 50` は 3 ファイルで再宣言されている: `src/dashboard/panels/asyncData/tagClusterPanel.ts:33`、`src/dashboard/panels/asyncData/wordClusterPanel.ts:45`、`src/dashboard/panels/asyncData/tagClusterTimeSliderPanel.ts:48`。
- `SVG_NS` は production 4 ファイルが宣言しており、`src/dashboard/panels/asyncData/tagClusterLoading.ts:15` を含む。
- drift として確認済みの観測差: `--tag-hue` を設定するのは比較パネルのみ（`src/dashboard/panels/asyncData/tagClusterTimeSliderPanel.ts:252`）で、単体 2 パネルは全ノード同色である。
- circle の class は単体パネルが `tag-cluster-node`、比較パネルが `tag-cluster-node tag-cluster-compare-node` である。
- row-cap メッセージの同形 2 箇所は `src/dashboard/panels/asyncData/wordClusterPanel.ts:103-110` と `src/dashboard/panels/asyncData/tagClusterTimeSliderPanel.ts:152-162` である。
- `notices.show('truncated')` と `hide` の 3 連は 3 パネルの各 3 箇所（`tagClusterPanel.ts:114-119`、`wordClusterPanel.ts:161-166`、`tagClusterTimeSliderPanel.ts:180-185`）にある。
- 見た目（色分けと class）は現行パネルごとの差を維持する。意図的な差と判断しており、単体パネルは単色が現行 UI 契約である。
- 抽出先は `src/dashboard/panels/asyncData/clusterGraphRenderer.ts`（dashboard 内、Layer 2 側）相当である。
- 依存として `src/dashboard/panels/asyncData/tagClusterTimeSliderPanel.ts` が 2026-09-28-09（lifecycle）・2026-09-28-11（local date）と共有しているため、これらの後に実装する。

## 実装者向け注記

### 現状コードの確認

- `src/dashboard/panels/asyncData/tagClusterPanel.ts:121-194`、`src/dashboard/panels/asyncData/wordClusterPanel.ts:168-239`、`src/dashboard/panels/asyncData/tagClusterTimeSliderPanel.ts:224-297` が同一骨格の逐語複製である。
- `MAX_NODES = 50` は `src/dashboard/panels/asyncData/tagClusterPanel.ts:33`、`src/dashboard/panels/asyncData/wordClusterPanel.ts:45`、`src/dashboard/panels/asyncData/tagClusterTimeSliderPanel.ts:48` の 3 箇所。
- `SVG_NS` は production 4 ファイル（`src/dashboard/panels/asyncData/tagClusterLoading.ts:15` を含む）。
- 色分けは比較パネルのみ（`src/dashboard/panels/asyncData/tagClusterTimeSliderPanel.ts:252` が `--tag-hue` を設定）。単体 2 パネルは単色。
- circle class は単体 `tag-cluster-node`、比較 `tag-cluster-node tag-cluster-compare-node`。
- row-cap メッセージは `src/dashboard/panels/asyncData/wordClusterPanel.ts:103-110` と `src/dashboard/panels/asyncData/tagClusterTimeSliderPanel.ts:152-162` の 2 箇所。
- `notices.show('truncated')` / `hide` の 3 連は `src/dashboard/panels/asyncData/tagClusterPanel.ts:114-119`、`src/dashboard/panels/asyncData/wordClusterPanel.ts:161-166`、`src/dashboard/panels/asyncData/tagClusterTimeSliderPanel.ts:180-185` の 3 箇所。
- 依存 PBI 2026-09-28-09（asyncData lifecycle）と 2026-09-28-11（local date）が `src/dashboard/panels/asyncData/tagClusterTimeSliderPanel.ts` を共有している。

### 実装手順

1. 3 パネルの描画骨格を読み、共通化できない差（`--tag-hue` の設定有無、circle class、aria-label の文言、panZoom attach のタイミング）を洗い出す。
2. 差分が `nodeClassName` / `hueByRelativeSize` / `ariaLabel` 組立の 3 オプションで吸収できることを確認する。吸収できない差があれば共通化の範囲を再検討する。
3. `MAX_NODES` と `SVG_NS` の共通定数を作り、`src/dashboard/panels/asyncData/tagClusterLoading.ts:15` を含む production 4 ファイルの宣言を置き換える。
4. `src/dashboard/panels/asyncData/clusterGraphRenderer.ts` を作成し、描画骨格を移設する。
5. `src/dashboard/panels/asyncData/tagClusterPanel.ts:121-194` を共通レンダラの呼び出しへ置き換え、`MAX_NODES` の個別宣言（`:33`）を撤去する。
6. `src/dashboard/panels/asyncData/wordClusterPanel.ts:168-239` を置き換え、`MAX_NODES` の個別宣言（`:45`）と row-cap メッセージ（`:103-110`）を共通化側へ移す。
7. `src/dashboard/panels/asyncData/tagClusterTimeSliderPanel.ts:224-297` を置き換え、`MAX_NODES` の個別宣言（`:48`）と row-cap メッセージ（`:152-162`）を共通化側へ移す。`--tag-hue` の設定（`:252`）は比較パネル固有のオプションとして残す。
8. `notices.show('truncated')` / `hide` の 3 連（3 パネルの各 3 箇所）を共通化側へ移す。
9. 3 パネルの SVG 出力が抽出前と一致することを確認する。
10. `npm run validate` を実行し、型とテストの正常を確認する。

### 落とし穴

- pan / zoom の attach タイミングに差がある。共通化すると 1 パネルのタイミングに合わせ、観測される挙動が変わる可能性がある。attach 箇所は各パネルの呼び出し側で保持する。
- aria-label の文言差を変えない。共通化の過程で文言をまとめて揃えると UI 契約が変わる。
- 見た目の差（色分け・class）を意図的なものとして維持する。単体パネルを単色から `--tag-hue` ベースの色分けへ統一すると、現行 UI 契約に反する。
- `MAX_NODES` を共通定数へ寄せると、上限値の変更が 3 パネルに同時に波及する。意図した波及である旨を PR に記載する。
- 既存の表示テストがあれば維持する。無ければ新規の golden 的 pin は最小限にし、過剰テストにしない。
- 依存 PBI 2026-09-28-09 と 2026-09-28-11 が `src/dashboard/panels/asyncData/tagClusterTimeSliderPanel.ts` を共有しているため、先にهماを実装してから着手する。
- `src/dashboard/panels/asyncData/tagClusterLoading.ts:15` の `SVG_NS` は描画パネルと別系統のファイルである。共通定数の参照先に含め忘れると宣言の重複が残る。
- 共通化の差をオプションで吸収しきれず、共通関数に条件分岐を増やしかねない。分岐が増えた場合は共通化を見送る。

## 決定事項

1. 本 PBI を順位 17 として起票する理由は、既存台帳「renderTagGraph 抽出」のトリガー「3つ目のクラスタグラフ系パネルを追加する時」が既に発火済みであるためである（`wordClusterPanel` と `tagClusterTimeSliderPanel` が第 2・第 3 実装）。
2. 描画骨格（`limitToTopNodes` → `computeCanvasSize` → `computeLayout` → edge line → node circle + title + text → `role="img"` / `aria-label` → `TagClusterPanZoomController.attach`）を共通レンダラへ抽出する。3 パネルの逐語複製を解消する。
3. 抽出先は `src/dashboard/panels/asyncData/clusterGraphRenderer.ts`（dashboard 内、Layer 2 側）とする。
4. 差分は `nodeClassName` / `hueByRelativeSize` / `ariaLabel` 組立の 3 オプションで吸収する。
5. 見た目の差（色分け・class）は現行パネルごとの差を維持する。意図的な差であり、単体パネルが単色であることは現行 UI 契約である。
6. `MAX_NODES` と `SVG_NS` は 1 箇所に集約する。`SVG_NS` の参照は `src/dashboard/panels/asyncData/tagClusterLoading.ts:15` を含む production 4 ファイルが共通定数を参照する。
7. row-cap メッセージと `notices.show('truncated')` / `hide` の 3 連も共通化する。
8. テストは 3 パネルの SVG 出力 parity を基本とし、既存の表示テストがあれば維持する。新規の golden 的 pin は最小限に留め、過剰なテストを追加しない。
9. `src/dashboard/panels/asyncData/tagClusterTimeSliderPanel.ts` は 2026-09-28-09（lifecycle）と 2026-09-28-11（local date）と共有しているため、これらの後に実装する。

## Definition of Done

- [x] 共通レンダラが `src/dashboard/panels/asyncData/clusterGraphRenderer.ts` として作成され、描画骨格が 1 箇所に集約されている。
- [x] 3 パネル（`tagClusterPanel.ts:121-194`、`wordClusterPanel.ts:168-239`、`tagClusterTimeSliderPanel.ts:224-297`）が共通レンダラの呼び出しに置き換えられている。
- [x] `MAX_NODES` の宣言が 1 箇所に集約され、3 パネルの個別宣言が解消されている。
- [x] `SVG_NS` の宣言が 1 箇所に集約され、production 4 ファイル（`tagClusterLoading.ts:15` を含む）が共通定数を参照している。
- [x] 差分が `nodeClassName` / `hueByRelativeSize` / `ariaLabel` 組立のオプションで吸収されている。
- [x] 見た目が維持されている（比較パネルの色分け、単体 2 パネルの単色、circle class の差）。
- [x] aria-label の文言差が維持されている。
- [x] row-cap メッセージと `notices` の 3 連が共通化されている。
- [x] pan / zoom の attach タイミングが 3 パネルとも維持されている。
- [x] 3 パネルの SVG 出力が抽出前と一致する parity が確認されている。
- [x] 過剰な golden テストが追加されていない。
- [x] `npm run validate` が成功し、既存テストとビルドに回帰がない。
- [x] BDD 受け入れシナリオとテスト戦略の検証が完了している。
- [x] コードレビューが完了している。
