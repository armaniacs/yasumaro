# タグの関連グラフ表示ガイド / Tag Cluster Guide

[日本語](#日本語) | [English](#english)

---

## 日本語

### 概要

「Tag Cluster」は、記録したページに付いたタグ同士の関連性をグラフとして可視化する機能です。どんなトピックを組み合わせて読んでいるか、タグ間のつながりを一目で把握できます。

### グラフの見方

- **ノード（円）**: 1つのタグを表します。円が大きいほど、そのタグが使われた記録の件数が多いことを示します
- **エッジ（線）**: 2つのタグが同じ記録に同時に付いている（共起している）ことを表します。共起回数が多いほど太く表示されます

出現回数の多い上位50件のタグのみが表示されます。50件を超える場合は「上位N件のみ表示中」の通知が表示されます。

### 操作方法

| 操作 | 動作 |
|------|------|
| **ノードをクリック** | そのタグで履歴を絞り込み、SQLite Historyパネルに自動遷移します |
| **マウスホイール** | カーソル位置を中心にズームイン/アウト（0.3倍〜3倍） |
| **ドラッグ** | グラフ全体をパン（移動） |
| **ピンチ操作**（タッチ対応端末） | 2本指でズーム、1本指でパン |
| **+/− ボタン** | 中央基準でズームイン/アウト |
| **リセットボタン** | 表示を初期状態に戻す |

ドラッグ操作の直後にクリックしても誤ってタグ絞り込みが発火しないよう、5px以上のドラッグ移動があった場合はクリックとして扱われません。

### 読み込み時の進捗表示

グラフ生成中は、以下の4ステップの進捗がオーバーレイ表示されます。

1. データ読み込み
2. ノード分析（タグの共起関係を計算）
3. レイアウト計算（ノードの配置を決定）
4. グラフ描画

各ステップが完了すると、○ から ✓（緑）に切り替わります。

### 初回表示時の注意

拡張機能の起動直後は、SQLiteの初期化が完了していないタイミングでグラフが0件表示になることがあります。この場合は自動的にリトライされ、初期化完了後にグラフが正しく描画されます。手動でのページリロードは不要です。

---

## English

### Overview

"Tag Cluster" visualizes the relationships between tags attached to your recorded pages as a graph. It gives you an at-a-glance view of which topics you tend to read together.

### Reading the Graph

- **Nodes (circles)**: Each node represents one tag. Larger circles indicate the tag was used in more records
- **Edges (lines)**: An edge means two tags co-occur on the same record. Thicker edges indicate more frequent co-occurrence

Only the top 50 tags by frequency are shown. If there are more, a "showing top N only" notice appears.

### Controls

| Action | Behavior |
|--------|----------|
| **Click a node** | Filters history by that tag and automatically navigates to the SQLite History panel |
| **Mouse wheel** | Zoom in/out centered on the cursor (0.3x–3x) |
| **Drag** | Pan the graph |
| **Pinch** (touch devices) | Two fingers to zoom, one finger to pan |
| **+/− buttons** | Zoom in/out centered on the canvas |
| **Reset button** | Return the view to its initial state |

To prevent an accidental tag filter right after dragging, any movement over 5px is treated as a drag rather than a click.

### Loading Progress

While the graph is being generated, a 4-step progress overlay is shown:

1. Data loading
2. Node analysis (computing tag co-occurrence)
3. Layout calculation (determining node positions)
4. Graph rendering

Each step switches from ○ to ✓ (green) as it completes.

### Note on First Display

Right after the extension starts, SQLite initialization may not be complete yet, which can cause the graph to briefly show zero nodes. In this case, it automatically retries and renders correctly once initialization finishes. No manual page reload is needed.
