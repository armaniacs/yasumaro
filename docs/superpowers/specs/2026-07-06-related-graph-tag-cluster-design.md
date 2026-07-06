# 設計: 検索結果の関連グラフ / タグクラスタ表示

- 元PBI: [dev-docs/plans/2026-07-04-02-feat-related-graph-tag-cluster.md](../../../dev-docs/plans/2026-07-04-02-feat-related-graph-tag-cluster.md)
- 親issue: [DEV-86](https://linear.app/armaniacs/issue/DEV-86)

## 背景・現状分析

`src/offscreen/schema.ts` の `browsing_logs.tags` はTEXT型でカンマ区切りの文字列として保存されている（例: `"tech,ai,browser"`）。既存の `src/utils/tagUtils.ts` の `parseTagsForDisplay(tagsStr)` がこの文字列を配列に変換するユーティリティとして存在し、`src/dashboard/sqliteHistoryPanel.ts` で使われている。

`src/dashboard/tagsPanel.ts` はタグの正規化辞書・カテゴリ管理UIであり、共起集計やグラフ描画の機能は含まれていない。本PBIは新規パネルとして実装する。

## 対象スコープ

1. タグ共起（同一履歴エントリに同時に付与されたタグの組み合わせ）を集計する
2. タグをノード、共起関係をエッジとしたグラフをダッシュボードに描画する
3. ノードクリックで該当タグを持つ履歴一覧にフィルタする
4. タグが存在しない場合は空状態を表示し、エラーを出さない

## アーキテクチャ

```
[Dashboard] 新規パネル src/dashboard/tagClusterPanel.ts
  1. sqliteHistoryPanel.ts と同様の経路で browsing_logs 全件の (id, tags) を取得
  2. JS側で共起集計（タグペアごとのカウント）
  3. 力学モデル（force-directed）で簡易レイアウト計算
  4. SVGでノード・エッジを描画
  5. ノードクリック → historyFilters.ts のタグフィルタと連動
```

外部グラフ描画ライブラリ（d3-force等）は導入せず、自作のSVG描画とする。CSP準拠（外部CDN不要）とバンドルサイズ増加の回避を優先する。

## データ設計・集計ロジック

新規モジュール `src/dashboard/tagCooccurrence.ts` を作成する。

```typescript
export interface TagNode {
  tag: string;
  count: number;       // このタグが付与された履歴件数
}

export interface TagEdge {
  source: string;
  target: string;
  weight: number;       // 共起回数
}

export function computeTagCooccurrence(
  entries: Array<{ tags: string | null }>
): { nodes: TagNode[]; edges: TagEdge[] } {
  // 1. 各エントリの tags を parseTagsForDisplay() で配列化
  // 2. タグごとの出現回数を集計 → TagNode[]
  // 3. 同一エントリ内の全タグペア（順不同、正規化してsource<target）の共起回数を集計 → TagEdge[]
}
```

- 集計はSQL側で行わず、`browsing_logs` から `(id, tags)` を全件取得しJS側でメモリ集計する。個人利用規模（数千〜数万件）では十分高速であり、SQLite JSON1拡張への依存を避けられる
- ノード数上限: 出現回数上位N件（デフォルト50件）に制限し、切り捨てが発生した場合はUIに「上位N件のみ表示中」を明示する
- エッジは表示対象ノード間のもののみ描画する

## コンポーネント設計

### 1. `src/dashboard/tagCooccurrence.ts`（新規）
- `computeTagCooccurrence()`: 純粋関数。上記の集計ロジック
- `limitToTopNodes(nodes, edges, n)`: 上位N件に絞り込み、関連エッジも絞り込む

### 2. `src/dashboard/tagClusterPanel.ts`（新規）
- `initTagClusterPanel()`: パネル初期化。データ取得 → 集計 → レイアウト計算 → SVG描画
- 簡易force-directedレイアウト: 反発力（全ノード間）+ 引力（エッジで結ばれたノード間）を数十イテレーション計算し、座標を確定する（`d3-force`相当のロジックを最小実装として自前で書く）
- ノードクリックハンドラ: 既存の `document.dispatchEvent(new CustomEvent('navigate-to-tag', { detail: tag }))`（`tagsPanel.ts` の47-50行目と同じパターン）を再利用し、`historyFilters.ts` のタグフィルタに連動させる
- データ0件時: 空状態メッセージ要素を表示し、SVG描画処理をスキップする

### 3. `entrypoints/options/index.html`（拡張）
- サイドナビに新規パネル項目（`data-panel="panel-tag-cluster"`）を追加

## エラーハンドリング

| ケース | 挙動 |
|---|---|
| タグ付き履歴が0件 | 空状態メッセージを表示し、SVG描画をスキップ（例外を出さない） |
| タグが1種類のみ（エッジなし） | ノード1つのみ描画。エッジ計算はスキップ |
| ノード数が上限（50件）を超える | 出現頻度上位50件のみ描画し、切り捨てをUIに明示 |

## テスト戦略（t_wadaスタイル）

### 単体テスト
- `computeTagCooccurrence()`: 空配列、単一タグ、複数タグの共起パターン、同一タグの重複カウント排除
- `limitToTopNodes()`: 上限以下・上限超過・境界値（ちょうどN件）

### 統合テスト
- タグ共起集計結果から、`tagClusterPanel.ts` がノードクリックイベントを発火し `historyFilters.ts` と連動すること

### E2Eテスト
- タグ付き履歴投入 → グラフ表示 → ノードクリックで該当タグの履歴に絞り込まれる
- タグなし履歴のみの状態でパネルを開く → 空状態が表示されエラーが出ない

## 実装アプローチ

Outside-In / Red-Green-Refactor。`computeTagCooccurrence()` の単体テストから着手し、レイアウト計算、SVG描画、UI結線の順に進める。

## 技術的考慮事項

- 依存: なし（#03のタグ正規化辞書が既に完了しているため、正規化済みタグでの集計となり品質が高い）
- 再利用: `src/utils/tagUtils.ts`（`parseTagsForDisplay`）、`src/dashboard/tagsPanel.ts`（`navigate-to-tag` イベントパターン）、`src/dashboard/historyFilters.ts`
- 力学レイアウト計算はメインスレッドで行うため、ノード数上限（50件）により計算コストを抑える

## スコープ外（YAGNI）

- ノード数上限のユーザー設定変更機能（固定値50から開始し、将来必要になれば設定化する）
- グラフのズーム・パン等の高度なインタラクション
- タグ以外のエンティティ（ドメイン等）を含めたグラフ拡張

## Definition of Done

- [ ] 全BDDシナリオが自動テスト化されパスする
- [ ] カバレッジ基準を満たす
- [ ] コードレビュー / リファクタ完了
- [ ] ドキュメント更新
