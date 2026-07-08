# PBI: Tag Cluster グラフのパン・ズーム対応

## ユーザーストーリー
Yasumaro ダッシュボードで自分の閲覧履歴タグの関係性を探るユーザーとして、Tag Cluster グラフをドラッグ・ホイール・ピンチ・ボタン操作で自由に移動・拡大縮小したい、なぜなら現状はノード数が増えるとグラフがパネル幅（`max-width: 680px`）をはみ出し、右側・下側のノードが一切見えず機能不全になっているから。

## ビジネス価値
- 現状、タグ数が多いユーザー（ヘビーユーザーほど）ほどグラフの大部分が不可視になり、Tag Cluster機能の価値をまったく享受できていない
- パン・ズームにより、全ノード数（最大50件、`MAX_NODES`）に関わらずグラフ全体を探索可能にする
- 測定方法：実装後、50ノード相当のテストデータで全ノードにドラッグ・ズーム操作のみでアクセスできることを確認する

## 既実装確認結果
`grep -rn "viewBox\|panZoom\|wheel\|pointerdown"` で `src/dashboard/*.ts` を検索した結果、パン・ズーム関連の実装は存在しないことを確認済み（2026-07-08時点）。`tagClusterPanel.ts` は SVG に `width`/`height` 属性のみを設定し `viewBox` は未設定、`tagClusterLayout.ts` の `computeLayout()` は固定サイズの座標空間（呼び出し側から渡された `width`/`height`、現状 `svg.getAttribute('width')` 由来で実質800×600固定）でノードをクランプしているのみ。未実装であることを前提にPBIを進める。

## Deep-dig（feature-dev Phase 2b）での決定事項（2026-07-08）
コードベース調査の結果、以下の3点をユーザーと確認し、当初PBI記述から変更した：

1. **イベント方式**: `pointerdown`/`pointermove`（Pointer Events API）ではなく、**`MouseEvent` + `wheel` で実装する**。理由：プロジェクト内に `PointerEvent` の使用実績が皆無で、jsdomでの `PointerEvent` サポートが不確実なため、テストの安定性を優先。ピンチズームは `TouchEvent` で別途対応する。
2. **テスト方針**: Playwright E2Eは**今回見送り、vitest（単体・統合）のみで実装する**。理由：`options.html`（ダッシュボード）向けのE2E fixtureがプロジェクトに一切存在せず、新規作成すると拡張機能ロード+SVG操作という前例のない組み合わせで見積もり（5pt）を超える工数become。E2E fixture整備は別タスクとする。
3. **座標空間設計**: 別途「論理座標系」を用意して変換層を挟むのではなく、**`computeLayout()` に渡す `width`/`height` 引数をそのまま `viewBox` の値として使う**。既存のclamp処理に一切手を入れず、`tagClusterPanel.ts` 側でノード数から算出した `width`/`height` を `computeLayout` と `viewBox` の両方に渡すだけにする。

## BDD受け入れシナリオ

```gherkin
Scenario: ノードが多くグラフがパネル幅を超える場合にドラッグで見えなかった部分を確認できる
  Given Tag Cluster パネルにタグ付き履歴が50件相当あり、初期表示ではノードの一部が画面外にある
  When  ユーザーがグラフ領域をマウスでドラッグする
  Then  グラフ全体が指の動きに追従して移動し、それまで見えなかったノードが表示範囲内に入る

Scenario: マウスホイールでグラフを拡大縮小できる
  Given Tag Cluster パネルにグラフが表示されている
  When  ユーザーがグラフ領域上でマウスホイールを操作する
  Then  カーソル位置を中心にグラフが拡大または縮小される
  And   ズーム倍率は0.3倍〜3倍の範囲に収まる

Scenario: リセットボタンで初期表示状態に戻せる
  Given ユーザーがドラッグ・ズーム操作でグラフの表示位置・倍率を変更した状態
  When  ユーザーが「リセット」ボタンをクリックする
  Then  グラフは初期表示時のズーム倍率（100%）・表示位置に戻る

Scenario: ノード数が少なく全ノードが画面内に収まる場合は操作しなくても全体が見える
  Given Tag Cluster パネルにタグ付き履歴が数件のみ存在する
  When  パネルを開く
  Then  パン・ズーム操作をしなくても全ノードが初期表示の画面内に収まっている
```

## 受け入れ基準
- [ ] SVGに `viewBox` が導入され、パン・ズームは `viewBox` の書き換えで実現されている（外部ライブラリ非依存）
- [ ] マウスホイールでのズームができる（カーソル位置を中心とした拡大縮小）
- [ ] マウスドラッグでのパンができる
- [ ] トラックパッドのピンチ操作でズームができる
- [ ] ズームイン/ズームアウトボタン（+/-）がパネルに設置され、クリックで動作する
- [ ] リセットボタンが設置され、クリックで初期表示（ズーム100%・初期位置）に戻る
- [ ] ズーム倍率は0.3倍〜3倍の範囲に制約されている（それ以上/以下にはならない）
- [ ] レイアウト計算の座標空間（`computeLayout` に渡す `width`/`height`）はノード数に応じて動的に拡大される
- [ ] 初期表示のズームレベルは固定100%（自動フィットはしない）
- [ ] 既存のノードクリック時の `navigate-to-tag` イベント発火は、パン・ズーム操作と競合せず引き続き正しく動作する（ドラッグ中の誤クリック発火がない）
- [ ] 既存の `tagClusterPanel.test.ts` の全テストが引き続きパスする

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 見送り（Deep-dig決定事項参照）。`options.html` 向けE2E fixtureの整備は別タスクとする。

### 統合テスト
- `tagClusterPanel.ts` に `TagClusterPanZoomController` を統合した状態で、SVG生成後に `viewBox` 属性が期待通り設定されていることを確認するテスト（vitest + jsdom）
- ノード数に応じて `computeLayout` に渡される座標空間サイズが変化することを確認するテスト

### 単体テスト
- `TagClusterPanZoomController`（`MouseEvent`/`wheel`/`TouchEvent`ベース、Deep-dig決定事項参照）:
  - `wheel` イベントでの `viewBox` のズーム計算（境界値：0.3倍未満にならない、3倍を超えない）
  - `mousedown`/`mousemove`/`mouseup` によるパン処理での `viewBox` の `x`/`y` 更新
  - ピンチズーム（2点の `touch` イベント）でのズーム率計算
  - リセットボタン押下で初期 `viewBox` 値に戻ることの検証
  - ドラッグ操作中はノードのクリックイベント（`navigate-to-tag`）が誤発火しないこと（クリックとドラッグ開始の判定閾値のテスト）
- `tagClusterLayout.ts` の座標空間動的計算関数:
  - ノード数0件・1件・50件それぞれでの座標空間サイズの境界値テスト
  - 上限キャップが機能すること

## 実装アプローチ
- **Outside-In**: まず統合テスト（SVGに `viewBox` が設定される）を書いて失敗を確認し、`TagClusterPanZoomController` の単体テストをRed-Green-Refactorで積み上げてから `tagClusterPanel.ts` へ統合する
- **Red-Green-Refactor**: 各操作（ズーム、パン、ピンチ、ボタン、リセット）ごとに独立してテストサイクルを回す
- **リファクタリング**: 全操作がグリーンになった時点で、`TagClusterPanZoomController` 内の座標変換ロジックの重複を整理する

## 見積もり
5 pt（既存パネルへの追加機能、新規モジュール1つ、既存ファイル2つの軽微な修正）

## 技術的考慮事項
- 依存関係: 直前に実装済みの「Tag Clusterローディング進捗表示」「SQLite初期化リトライ」機能（`tagClusterPanel.ts` に統合済み）と共存すること。`initTagClusterPanel()` の既存の `try/catch` 構造・`loadingManager.cleanup()` 呼び出しタイミングを壊さないこと
- テスタビリティ: `TagClusterPanZoomController` はDOM操作を行うクラスのため、jsdom環境でのイベントシミュレーション（`dispatchEvent(new WheelEvent(...))` 等）でテストする
- 非機能要件: 特になし（パフォーマンス要件は既存の50ノード制約内で妥当）

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
grep -rn "viewBox\|panZoom\|wheel\|pointerdown" src/dashboard/*.ts
```
2026-07-08時点でヒットなし（未実装）を確認済み。もし実装が進んでいれば、このPBIは「拡張・改善タスク」として読み替えること。

### 実装手順
1. `src/dashboard/tagClusterLayout.ts` に座標空間サイズを計算する関数を追加する（例：`computeCanvasSize(nodeCount: number): { width: number; height: number }`）。式の目安は `width = Math.min(2400, Math.max(800, 400 + nodeCount * 40))`、`height` も同様の比率で計算し、上限でキャップする。この関数の戻り値を `computeLayout()` と `viewBox` 初期化の両方にそのまま渡す（変換層は挟まない、Deep-dig決定事項）
2. `src/dashboard/tagClusterPanZoom.ts` を新規作成し、`TagClusterPanZoomController` クラスを実装する（`TagClusterLoadingManager` と同じ設計パターン：コンストラクタでDOM要素受け取り、privateフィールドで状態保持、`attach()`/`cleanup()`ライフサイクル）。コンストラクタで `SVGSVGElement` と座標空間サイズ（`computeCanvasSize()`の戻り値）を受け取り、`viewBox` の初期値をこの座標空間サイズと同一にする
3. コントローラ内で以下のイベントリスナーをSVG要素に登録する（**`MouseEvent`/`wheel`/`TouchEvent`ベース、`PointerEvent`は使わない** — Deep-dig決定事項）：
   - `wheel`：`event.deltaY` の符号でズームイン/アウト、`event.clientX/Y` から SVG 座標系への変換でカーソル位置中心ズームを実装
   - `mousedown` → `mousemove` → `mouseup`：ドラッグ開始位置との差分で `viewBox.x/y` を更新。ただし累積移動距離が閾値（例：5px）未満ならクリックとみなし `navigate-to-tag` の発火を妨げない
   - ピンチズーム：`touchstart`/`touchmove`/`touchend` で2点のタッチを追跡し、2点間距離の変化率でズーム倍率を計算
4. ズームイン/アウト/リセットボタンはHTML要素として `panel-tag-cluster` セクション内、SVGの直前または直後に配置し、`TagClusterPanZoomController` の公開メソッド（`zoomIn()`, `zoomOut()`, `reset()`）を呼び出す
5. `src/dashboard/tagClusterPanel.ts` の `initTagClusterPanel()` 内、ノード・エッジのSVG描画が完了した後（`loadingManager.updateStep(3)` の直前あたり）で `TagClusterPanZoomController` を生成しSVGにアタッチする。既存の `loadingManager.cleanup()` の呼び出し順は変更しない
6. `entrypoints/options/index.html` の `<svg id="tagClusterSvg" width="800" height="600"></svg>` 部分に、ズームボタン・リセットボタンのHTML要素を追加する

### 落とし穴
- `viewBox` の `width`/`height` は正の数でなければならない。ズーム計算で0や負数にならないよう、必ず0.3倍〜3倍のクランプを先に適用してから `viewBox` に書き込むこと
- ドラッグ操作とノードクリック（`navigate-to-tag` 発火）が競合しやすい。`mousedown` からの累積移動距離が閾値以下の場合のみクリックとして扱う判定を必ず入れること（そうしないと、ノードをドラッグで少し動かしたつもりが誤って別タグの履歴に遷移してしまう）
- 前回実装のローディング表示（`TagClusterLoadingManager`）は `svg.firstChild` を全削除して再構築する。`TagClusterPanZoomController` がリスナー登録した後にローディングオーバーレイの `show()`/`cleanup()` でSVGの子要素が入れ替わっても、コントローラ自体はSVG要素そのものにリスナーを貼っているため影響を受けないはずだが、統合時に必ず動作確認すること
- `getBoundingClientRect` はプロジェクト内で一度もモックされた実績がない。座標変換のテストでは `vi.spyOn(svgElement, 'getBoundingClientRect').mockReturnValue({...} as DOMRect)` を新規に導入すること
- `entrypoints/options/dashboard.css` の `.panel { max-width: 680px; }` は変更しない前提（SVGの実表示幅はこの制約内に収まるようにし、座標空間サイズだけを内部的に広げる）。SVG要素自体のCSS幅を680pxより大きくしないよう注意（`viewBox` があれば `width`/`height` 属性値と実表示サイズが異なっても正しく縮小表示されるが、CSSで明示的に幅を固定していないか確認すること）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み（CHANGELOG.md にユーザー向け機能追加として記載）
