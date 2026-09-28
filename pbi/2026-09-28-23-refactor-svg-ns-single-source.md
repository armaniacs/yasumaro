# PBI: SVG namespace 定数の単一ソース化（clusterGraphRenderer 抽出の残留 2 ファイル + doc drift）

## ユーザーストーリー

保守者として、SVG namespace 定数を完全に 1 箇所にしたい。なぜなら PBI `2026-09-28-17` で 3 クラスタパネルは単一のレンダラに統合されたが、`SVG_NS` を使う残り 2 ファイルが再宣言したまま残っており、関連 doc の記述も移設前のファイル名を指したままでドキュメントがドリフトしているからだ。

## ビジネス価値

- `SVG_NS` の再宣言 3 箇所（SSOT 1 + 残 2）を単一ソースへ寄せ、namespace 値の変更時に触る箇所を 1 にする。
- ドキュメントドリフト（移設済みの定数を旧ファイル名で参照しているコメント）を現状参照へ直し、レビュー時に「定数はどこにあるか」を探すコストを無くす。
- PBI `2026-09-28-17` が確立した「3 クラスタパネルは単一レンダラ」という方向を、定数レベルでも最後まで貫く。
- DOM 非依存の純文字列定数なので Layer 0（`src/utils/`）に置ける。層の下向きの依存に違反しない。

## 優先度

- 種別: refactor
- 順位: 23 / 23
- RICEスコア: 1.0（Reach=1 / Impact=0.5 / Confidence=100% / Effort=0.5 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: SVG namespace 定数の宣言が 1 箇所に集まる
  Given dashboard 配下で SVG_NS が SSOT として 1 箇所、他 2 ファイルで再宣言されている
  And 1 つのファイルは root 直下にあり、root から panels/ へ import すると層の方向が逆転する
  When 各ファイルが SVG 要素を生成する経路を追う
  Then 3 ファイルすべてが単一の純文字列定数を import して createElementNS に渡している
  And 定数値の再宣言が production コードに存在しない

Scenario: SSOT の移設が既存の import 契約と実装 differentials を壊さない
  Given 3 クラスタパネルは clusterGraphRenderer 経由で SVG 要素を生成する
  When SSOT を Layer 0 へ移して 3 箇所の import を更新する
  Then レンダラの描画結果（node cap / canvas size / layout / edges / nodes / a11y 属性）は不変である
  And row-cap notices と MAX_NODES 単一化の挙動が維持される

Scenario: 定数を参照するドキュメントの drift が解消される
  Given doc コメントが移設済みの定数を旧ファイル名で参照している
  When そのコメントの参照先を確認する
  Then 実在するファイルの現在の配置を指している
  And 読者が定数の位置を旧ファイル名から探し直す必要がない
```

## 受け入れ基準

- [ ] 実装冒頭で Layer 0 に SVG 定数モジュールを置くことの妥当性を判断する。既存の SVG 関連 util（`src/dashboard/graphNodeA11y.ts` など）の配置を確認し、「Layer 0 共有定数モジュール」と「dashboard 内共有定数モジュール」のどちらが妥当かを決めて記録している。
- [ ] `SVG_NS` の宣言が production コードに 1 箇所だけになり、3 ファイル（`clusterGraphRenderer` / `tagClusterLoading` / `tagFrequencyTimelinePanel`）がすべて import 経由で参照している。
- [ ] `src/dashboard/tagClusterLoading.ts:15` の再宣言が import 置換されている（root 直下から `panels/` へ import する方向の逆転を発生させていない）。
- [ ] `src/dashboard/panels/asyncData/tagFrequencyTimelinePanel.ts:37` の再宣言が import 置換され、`:62` の `createElementNS` が同じ単一ソースを参照している。
- [ ] `clusterGraphRenderer` の `SVG_NS` の `export` は、17 の既存 import との互換を保つため re-export として残すか全 import 更新後に削除するかを判断し、その判断を記録している。いずれの場合も本 PBI 内で全 import 更新まで完了している。
- [ ] `src/utils/computeLimits.ts:11` のコメントが、現状の `MAX_NODES` の配置を指す参照へ修正されている。
- [ ] 既存の関連テスト（clusterGraphRenderer テスト、PanZoom 関連、tagClusterLoading 関連）が緑である。新規テストは追加していない。
- [ ] `npm run validate` が成功し、既存の描画挙動に回帰がない。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 3 クラスタパネル（tag-cluster / word-cluster / tag-cluster-compare）の描画を操作し、SVG 要素が名前空間付きで生成され、node cap・canvas size・layout・edges・nodes・role / aria-label・pan/zoom が baseline と一致することを確認する。
- row-cap notice（cap 到達時のメッセージ）が baseline と同じ文言・同じ条件で表示されることを確認する。
- tag frequency timeline パネルを描画し、セル・軸ラベル・凡例ラベルが baseline と一致することを確認する。
- 新しいユーザー機能は追加せず、Outside-In の観測点は「既存の描画観測挙動が不変であること」。

### 統合テスト

- 3 ファイルがすべて単一ソースから import していることを確認する（production コードに `SVG_NS` の宣言が 1 箇所だけであることを静的チェックで確認する）。
- `src/dashboard/tagClusterLoading.ts:15` の PanZoom overlay widget が import 変更後も同一の namespace で SVG を生成することを確認する。
- 層の方向が逆転していないことを確認する（`src/dashboard/tagClusterLoading.ts` から `panels/` 配下を import していない）。

### 単体テスト

- 定数値の同一性は型と import で担保できるため、新規の単体テストは追加しない。
- 既存の `src/dashboard/panels/asyncData/__tests__/clusterGraphRenderer.test.ts`、`src/dashboard/__tests__/tagClusterLoading.test.ts`、PanZoom 関連テストを緑に保つ。
- `src/dashboard/panels/asyncData/__tests__/tagFrequencyTimelinePanel.lifecycle.test.ts` など timeline 関連テストを緑に保つ。
- 宣言重複を検出する静的 pin（`SVG_NS` の production 宣言が 1 箇所であること）の要否は実装時に判断する。追加する場合は軽い grep ベース static check とする。

## 実装アプローチ

- **Outside-In**: 先にproduction コード中の `SVG_NS` 宣言箇所を列挙し、SSOT 1 箇所 + 再宣言 2 箇所であることを Red として記録する。
- **Red-Green-Refactor**: 単一ソースモジュールを新設して 3 箇所の import へ置き換え、1 箇所ずつ緑を確認してから次へ進む。
- **SSOT の配置判断**: `SVG_NS` は DOM 非依存の純文字列定数なので Layer 0（`src/utils/`）に置ける。実装冒頭で既存の SVG 関連 util（`src/dashboard/graphNodeA11y.ts` など）の配置を確認して決める。他の SVG 定数が増える見込みなら dashboard 内共有定数モジュールでもよい。
- **export の互換性**: `clusterGraphRenderer` の `SVG_NS` の `export` は 17 互換のため re-export で残せる。ただし本 PBI 内で全 import 更新まで完了させ、恒久的な二重公開を残さない。
- **doc drift の修正**: `src/utils/computeLimits.ts:11` のコメントを現状参照へ直す。定数の実数は変えず、コメントの参照先だけ直す。
- **変更順序**: 配置判断 → SSOT 新設 → 3 箇所の import 置換 → re-export / export 方針の確定 → doc コメント修正 → 関連テスト緑確認。

## 見積もり

**0.5 SP**

- 配置判断と全数調査（既存の SVG 関連 util の位置、3 箇所の宣言箇所）: 0.1 SP
- SSOT モジュールの新設と 3 箇所の import 置換（うち 1 箇所は層方向の注意が必要）: 0.25 SP
- doc コメント修正と export 方針の確定、関連テストの緑確認: 0.15 SP

新しいロジックを含まない機械的な定数の移設であり、実行時の描画パスは変わらない。

## 技術的考慮事項

- SSOT: `src/dashboard/panels/asyncData/clusterGraphRenderer.ts:28` の `export const SVG_NS = 'http://www.w3.org/2000/svg'`（Layer 2・dashboard panels 配下）。
- 再宣言 1: `src/dashboard/tagClusterLoading.ts:15`（dashboard root 直下・PanZoom overlay widget。root から `panels/` へ import すると方向が逆転するため 17 では触れなかった）。
- 再宣言 2: `src/dashboard/panels/asyncData/tagFrequencyTimelinePanel.ts:37`（`panels` 配下だが 17 の whitelist 外だった。`:62` で `createElementNS` に使用）。
- doc drift: `src/utils/computeLimits.ts:11` が「`MAX_NODES = 50` in `tagClusterPanel.ts`」と記すが、`MAX_NODES` は `clusterGraphRenderer.ts` へ移設済み。
- 方針: `SVG_NS` は DOM 非依存の純文字列定数のため `src/utils/svgNamespace.ts`（Layer 0・新規）へ置き、3 箇所を import へ置換する。
- 層的方向: root 直下の `tagClusterLoading` から `panels/` 配下を import すると方向が逆転する。Layer 0 置きならこの逆転が解消する。
- 既存 SVG 関連 util は `src/dashboard/graphNodeA11y.ts` にあるが、これは dashboard 内の a11y ヘルパで純定数ではない。Layer 0 置きはこれと競合しない。
- 上流 PBI `2026-09-28-17` の「row-cap notices / `MAX_NODES` 単一化」の決定は変更しない。`MAX_NODES` は本 PBI の移設対象外である。
- テスト内のローカルな `SVG_NS` 宣言（各テストファイル内の `const SVG_NS = ...`）は production の SSOT とは別系統であり、移設対象に含めない。

## 実装者向け注記

### 現状コードの確認

- SSOT は `src/dashboard/panels/asyncData/clusterGraphRenderer.ts:28`（`export const SVG_NS`）。`MAX_NODES` は同ファイルで単一化済み。
- `src/dashboard/tagClusterLoading.ts:15` に同値のローカル宣言があり、dashboard root 直下の PanZoom overlay widget で使う。
- `src/dashboard/panels/asyncData/tagFrequencyTimelinePanel.ts:37` に同値のローカル宣言があり、`:62` の `svgEl` helper（`document.createElementNS(SVG_NS, name)`）で使う。
- `src/utils/computeLimits.ts:11` のヘッダコメントが `MAX_NODES = 50` の位置を `tagClusterPanel.ts` と記しているが、`MAX_NODES` は `clusterGraphRenderer.ts` へ移設済み。
- 既存の SVG 関連 util は `src/dashboard/graphNodeA11y.ts`。純定数モジュールではなく Layer 0 の配置とは別物である。
- テストファイル内には複数のローカルな `SVG_NS` 宣言があるが、これは production の SSOT とは別系統である。
- 関連テストとして `src/dashboard/panels/asyncData/__tests__/clusterGraphRenderer.test.ts`、`src/dashboard/__tests__/tagClusterLoading.test.ts`、PanZoom 関連、`tagFrequencyTimelinePanel.lifecycle.test.ts` が存在する。

### 実装手順

1. 実装冒頭で SVG 定数モジュールの配置を決める。`src/dashboard/graphNodeA11y.ts` などの既存 SVG 関連 util の配置を確認し、Layer 0 共有定数モジュール（`src/utils/svgNamespace.ts`）と dashboard 内共有定数モジュールのどちらが妥当かを判断して記録する。他の SVG 定数が増える見込みをrieviewする。
2. production コード中の `SVG_NS` 宣言箇所を全数列挙し、SSOT 1 箇所 + 再宣言 2 箇所であることを Red として記録する。
3. 単一ソースモジュールを新設する。`SVG_NS` の値（`'http://www.w3.org/2000/svg'`）は変更しない。LAYERS.md の新規ファイル配置チェックリストに従って層コメントを付与する。
4. `src/dashboard/panels/asyncData/clusterGraphRenderer.ts:28` を re-export（17 互換）へ置き換えて、SSOT の位置を 1 箇所にする。
5. `src/dashboard/panels/asyncData/tagFrequencyTimelinePanel.ts:37` の宣言を削除し、`:62` の `createElementNS` が単一ソースを参照するようにする。
6. `src/dashboard/tagClusterLoading.ts:15` の宣言を削除し、import へ置き換える。root 直下から `panels/` 配下を import していないことを確認する。
7. 3 ファイルがすべて単一ソースから import であることを確認する。
8. `clusterGraphRenderer` の re-export について、17 互換を残すか全 import 更新後に削除するかを判断して記録する。いずれの場合も本 PBI 内で全 import 更新まで完了する。
9. `src/utils/computeLimits.ts:11` のコメントを、`MAX_NODES` の現状の配置を指す参照へ修正する（定数の実数は変えない）。
10. 関連テスト（clusterGraphRenderer テスト、tagClusterLoading テスト、PanZoom 関連、timeline 関連）が緑であることを確認する。`npm run validate` を実行する。
11. PBI `2026-09-28-17` の「row-cap notices / `MAX_NODES` 単一化」の挙動が変わっていないことを確認する。

### 落とし穴

- Layer 0 に「SVG namespace 定数」を置くことの妥当性は、実装冒頭の判断事項である。他に SVG 定数が増えるなら dashboard 内共有定数モジュールでもよい。既存の SVG 関連 util（`graphNodeA11y.ts` など）の配置を確認してから決めること。
- `src/dashboard/tagClusterLoading.ts` は dashboard root 直下にあるため、`panels/` 配下の `clusterGraphRenderer` から import すると層の方向が逆転する。Layer 0 置きはこの逆転を解消するが、逆に `panels/` 側から root 側を import しないことを必ず確認する。
- `clusterGraphRenderer` の `SVG_NS` の `export` を単純に削除すると、17 で確立した既存 import 契約が壊れる。re-export で残すか、全 import 更新後に削除するかを先に決め、その判断を記録する。
- doc コメントの参照先（`computeLimits.ts:11`）を直す際に、定数の実数（`MAX_NODES` の値）まで変えてはいけない。コメントの参照先だけ直す。
- テストファイル内のローカルな `SVG_NS` 宣言まで一括置換すると、production の SSOT 関係と混同してテストが壊れる。移設対象は production 3 ファイルに限定する。
- PBI `2026-09-28-17` の「row-cap notices / `MAX_NODES` 単一化」の決定を壊さないこと。`MAX_NODES` は本 PBI の移設対象外であり、`SVG_NS` のみが対象である。
- 3 箇所の import 置換をまとめて機械的に行うと、1 箇所だけ layer 方向が逆転する可能性がある。1 箇所ずつ緑を確認しながら進める。

## 決定事項

1. 本 PBI は PBI `2026-09-28-17` が「既知残留」として記録した `SVG_NS` の再宣言 2 箇所と doc drift のみを扱う。17 の決定（3 クラスタパネルの単一レンダラ化・`MAX_NODES` 単一化・row-cap notices）は変更しない。
2. `SVG_NS` は DOM 非依存の純文字列定数のため `src/utils/svgNamespace.ts`（Layer 0・新規）へ置き、3 箇所を import へ置換する。`src/dashboard/tagClusterLoading.ts` から `panels/` 配下へ import する方向の逆転を発生させない。
3. SSOT モジュールの最終的な配置（Layer 0 共有定数 vs dashboard 内共有定数）は、実装冒頭で既存の SVG 関連 util（`graphNodeA11y.ts` など）の配置を確認して決める。他に SVG 定数が増える見込みなら dashboard 内共有定数モジュールでもよい。
4. `clusterGraphRenderer` の `SVG_NS` の `export` は 17 互換のため re-export で残せる。ただし本 PBI 内で全 import 更新まで完了させ、恒久的な二重公開を残さない。
5. `SVG_NS` の値（`'http://www.w3.org/2000/svg'`）は変更しない。移設のみاوية目的とする。
6. `MAX_NODES` は本 PBI の移設対象外である。`src/utils/computeLimits.ts:11` のコメントは参照先（実在する配置）を現状へ直すだけで、定数の実数は変えない。
7. テストファイル内のローカルな `SVG_NS` 宣言は production の SSOT とは別系統であり、移設対象に含めない。
8. 定数値の同一性は型と import で担保できるため、新規テストは追加しない。既存の関連テストを緑に保つことを DoD とする。宣言重複の静的 pin の要否は実装時に判断する。
9. `npm run validate` が成功すること、および PBI `2026-09-28-17` の「row-cap notices / `MAX_NODES` 単一化」の挙動が変わっていないことを完了条件として確認する。

## Definition of Done

- [ ] `SVG_NS` の宣言が production コードに 1 箇所だけになり、3 ファイル（`clusterGraphRenderer` / `tagClusterLoading` / `tagFrequencyTimelinePanel`）がすべて import 経由で参照している。
- [ ] SSOT モジュールの配置判断（Layer 0 vs dashboard 内）の理由が記録されている。
- [ ] `src/dashboard/tagClusterLoading.ts:15` の再宣言が import 置換され、root 直下から `panels/` 配下を import する方向の逆転が発生していない。
- [ ] `src/dashboard/panels/asyncData/tagFrequencyTimelinePanel.ts:37` の再宣言が import 置換され、`:62` の `createElementNS` が単一ソースを参照している。
- [ ] `clusterGraphRenderer` の re-export / export 削除の判断が記録され、本 PBI 内で全 import 更新が完了している。
- [ ] `src/utils/computeLimits.ts:11` のコメントが `MAX_NODES` の現状の配置を指す参照へ修正され、定数の実数が変わっていない。
- [ ] 3 クラスタパネル（tag-cluster / word-cluster / tag-cluster-compare）と tag frequency timeline パネルの描画観測挙動が refactor 前と不変であることを既存テストで確認している。
- [ ] PBI `2026-09-28-17` の「row-cap notices / `MAX_NODES` 単一化」の決定が維持されている。
- [ ] 新規テストを追加していない（定数値の同一性は型と import で担保する方針）。宣言重複の静的 pin を追加した場合はその判断理由が記録されている。
- [ ] `npm run validate` が成功し、既存動作に回帰がなく、コードレビューが完了している。
