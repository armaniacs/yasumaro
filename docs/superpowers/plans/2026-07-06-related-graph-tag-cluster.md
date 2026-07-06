# 検索結果の関連グラフ / タグクラスタ表示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 履歴のタグ共起関係を集計し、ダッシュボードにノード（タグ）とエッジ（共起関係）からなるグラフを描画する。ノードクリックで該当タグの履歴に絞り込む。

**Architecture:** `browsing_logs` から `(id, tags)` を全件取得し、新規 `src/dashboard/tagCooccurrence.ts` でJS側集計（共起カウント・上位N件への絞り込み）を行う。新規 `src/dashboard/tagClusterPanel.ts` が集計結果を簡易force-directedレイアウトで座標計算し、SVGで描画する。外部グラフライブラリは使わない。ノードクリックは既存の `navigate-to-tag` カスタムイベントパターン（`tagsPanel.ts` と同じ）を再利用する。

**Tech Stack:** TypeScript, Vitest, SVG (DOM API), Chrome Extension Manifest V3

---

### Task 1: タグ共起集計ロジック `computeTagCooccurrence` を実装する

**Files:**
- Create: `src/dashboard/tagCooccurrence.ts`
- Test: `src/dashboard/__tests__/tagCooccurrence.test.ts`（新規）

- [ ] **Step 1: 失敗させるテストを書く**

`src/dashboard/__tests__/tagCooccurrence.test.ts` を新規作成する:

```typescript
import { describe, it, expect } from 'vitest';
import { computeTagCooccurrence } from '../tagCooccurrence.js';

describe('computeTagCooccurrence', () => {
  it('returns empty nodes and edges for empty input', () => {
    const result = computeTagCooccurrence([]);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it('returns empty nodes and edges when no entries have tags', () => {
    const result = computeTagCooccurrence([{ tags: null }, { tags: '' }, { tags: undefined }]);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it('counts a single tag with no cooccurrence (no edges)', () => {
    const result = computeTagCooccurrence([{ tags: '#tech' }]);
    expect(result.nodes).toEqual([{ tag: 'tech', count: 1 }]);
    expect(result.edges).toEqual([]);
  });

  it('counts cooccurrence between two tags on the same entry', () => {
    const result = computeTagCooccurrence([{ tags: '#tech #ai' }]);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes).toContainEqual({ tag: 'tech', count: 1 });
    expect(result.nodes).toContainEqual({ tag: 'ai', count: 1 });
    expect(result.edges).toEqual([{ source: 'ai', target: 'tech', weight: 1 }]);
  });

  it('accumulates node count and edge weight across multiple entries', () => {
    const result = computeTagCooccurrence([
      { tags: '#tech #ai' },
      { tags: '#tech #ai' },
      { tags: '#tech' },
    ]);
    expect(result.nodes).toContainEqual({ tag: 'tech', count: 3 });
    expect(result.nodes).toContainEqual({ tag: 'ai', count: 2 });
    expect(result.edges).toEqual([{ source: 'ai', target: 'tech', weight: 2 }]);
  });

  it('does not double count a tag pair within the same entry regardless of order', () => {
    const result = computeTagCooccurrence([{ tags: '#ai #tech' }]);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toEqual({ source: 'ai', target: 'tech', weight: 1 });
  });

  it('handles three or more tags on the same entry (all pairs counted)', () => {
    const result = computeTagCooccurrence([{ tags: '#a #b #c' }]);
    expect(result.edges).toHaveLength(3);
    const pairs = result.edges.map(e => `${e.source}-${e.target}`).sort();
    expect(pairs).toEqual(['a-b', 'a-c', 'b-c']);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/dashboard/__tests__/tagCooccurrence.test.ts`
Expected: FAIL（`src/dashboard/tagCooccurrence.ts` が存在しない）

- [ ] **Step 3: `computeTagCooccurrence` を実装する**

```typescript
/**
 * tagCooccurrence.ts
 * Computes tag cooccurrence (nodes and edges) from browsing log entries.
 */

import { parseTagsForDisplay } from '../utils/tagUtils.js';

export interface TagNode {
  tag: string;
  count: number;
}

export interface TagEdge {
  source: string;
  target: string;
  weight: number;
}

export function computeTagCooccurrence(
  entries: Array<{ tags: string | null | undefined }>
): { nodes: TagNode[]; edges: TagEdge[] } {
  const nodeCounts = new Map<string, number>();
  const edgeWeights = new Map<string, number>();

  for (const entry of entries) {
    const tags = parseTagsForDisplay(entry.tags);
    if (tags.length === 0) continue;

    const uniqueTags = Array.from(new Set(tags));

    for (const tag of uniqueTags) {
      nodeCounts.set(tag, (nodeCounts.get(tag) ?? 0) + 1);
    }

    const sorted = [...uniqueTags].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const key = `${sorted[i]}|${sorted[j]}`;
        edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + 1);
      }
    }
  }

  const nodes: TagNode[] = Array.from(nodeCounts.entries()).map(([tag, count]) => ({ tag, count }));
  const edges: TagEdge[] = Array.from(edgeWeights.entries()).map(([key, weight]) => {
    const [source, target] = key.split('|');
    return { source, target, weight };
  });

  return { nodes, edges };
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/dashboard/__tests__/tagCooccurrence.test.ts`
Expected: PASS（全7ケース）

- [ ] **Step 5: コミット**

```bash
git add src/dashboard/tagCooccurrence.ts src/dashboard/__tests__/tagCooccurrence.test.ts
git commit -m "feat(tag-cluster): タグ共起集計ロジックを実装"
```

---

### Task 2: 上位N件へのノード絞り込み `limitToTopNodes` を実装する

**Files:**
- Modify: `src/dashboard/tagCooccurrence.ts`
- Test: `src/dashboard/__tests__/tagCooccurrence.test.ts`

- [ ] **Step 1: 失敗させるテストを書く**

`src/dashboard/__tests__/tagCooccurrence.test.ts` の末尾（既存の `describe('computeTagCooccurrence', ...)` ブロックの後）に追記する:

```typescript
import { limitToTopNodes } from '../tagCooccurrence.js';

describe('limitToTopNodes', () => {
  it('returns all nodes and edges when count is within the limit', () => {
    const nodes = [{ tag: 'a', count: 3 }, { tag: 'b', count: 1 }];
    const edges = [{ source: 'a', target: 'b', weight: 1 }];
    const result = limitToTopNodes(nodes, edges, 5);
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
  });

  it('keeps only the top-N nodes by count, descending', () => {
    const nodes = [
      { tag: 'low', count: 1 },
      { tag: 'high', count: 10 },
      { tag: 'mid', count: 5 },
    ];
    const result = limitToTopNodes(nodes, [], 2);
    expect(result.nodes.map(n => n.tag)).toEqual(['high', 'mid']);
  });

  it('drops edges referencing a node that was cut', () => {
    const nodes = [
      { tag: 'a', count: 10 },
      { tag: 'b', count: 5 },
      { tag: 'c', count: 1 },
    ];
    const edges = [
      { source: 'a', target: 'b', weight: 3 },
      { source: 'a', target: 'c', weight: 1 },
    ];
    const result = limitToTopNodes(nodes, edges, 2);
    expect(result.nodes.map(n => n.tag)).toEqual(['a', 'b']);
    expect(result.edges).toEqual([{ source: 'a', target: 'b', weight: 3 }]);
  });

  it('reports whether truncation occurred', () => {
    const nodes = [{ tag: 'a', count: 2 }, { tag: 'b', count: 1 }];
    const notTruncated = limitToTopNodes(nodes, [], 5);
    const truncated = limitToTopNodes(nodes, [], 1);
    expect(notTruncated.truncated).toBe(false);
    expect(truncated.truncated).toBe(true);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/dashboard/__tests__/tagCooccurrence.test.ts -t "limitToTopNodes"`
Expected: FAIL（`limitToTopNodes` が存在しない）

- [ ] **Step 3: `limitToTopNodes` を実装する**

`src/dashboard/tagCooccurrence.ts` の末尾に追加する:

```typescript
export function limitToTopNodes(
  nodes: TagNode[],
  edges: TagEdge[],
  limit: number
): { nodes: TagNode[]; edges: TagEdge[]; truncated: boolean } {
  if (nodes.length <= limit) {
    return { nodes, edges, truncated: false };
  }

  const topNodes = [...nodes].sort((a, b) => b.count - a.count).slice(0, limit);
  const topTagSet = new Set(topNodes.map(n => n.tag));
  const filteredEdges = edges.filter(e => topTagSet.has(e.source) && topTagSet.has(e.target));

  return { nodes: topNodes, edges: filteredEdges, truncated: true };
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/dashboard/__tests__/tagCooccurrence.test.ts`
Expected: PASS（全11ケース）

- [ ] **Step 5: コミット**

```bash
git add src/dashboard/tagCooccurrence.ts src/dashboard/__tests__/tagCooccurrence.test.ts
git commit -m "feat(tag-cluster): 上位N件へのノード絞り込みを実装"
```

---

### Task 3: 簡易force-directedレイアウト計算 `computeLayout` を実装する

**Files:**
- Create: `src/dashboard/tagClusterLayout.ts`
- Test: `src/dashboard/__tests__/tagClusterLayout.test.ts`（新規）

- [ ] **Step 1: 失敗させるテストを書く**

`src/dashboard/__tests__/tagClusterLayout.test.ts` を新規作成する:

```typescript
import { describe, it, expect } from 'vitest';
import { computeLayout } from '../tagClusterLayout.js';
import type { TagNode, TagEdge } from '../tagCooccurrence.js';

describe('computeLayout', () => {
  it('returns an empty map for no nodes', () => {
    const positions = computeLayout([], [], 400, 400);
    expect(positions.size).toBe(0);
  });

  it('assigns a position to every node', () => {
    const nodes: TagNode[] = [{ tag: 'a', count: 1 }, { tag: 'b', count: 1 }];
    const edges: TagEdge[] = [{ source: 'a', target: 'b', weight: 1 }];
    const positions = computeLayout(nodes, edges, 400, 400);
    expect(positions.size).toBe(2);
    expect(positions.has('a')).toBe(true);
    expect(positions.has('b')).toBe(true);
  });

  it('keeps all node positions within the canvas bounds', () => {
    const nodes: TagNode[] = [
      { tag: 'a', count: 5 }, { tag: 'b', count: 3 }, { tag: 'c', count: 1 },
    ];
    const edges: TagEdge[] = [
      { source: 'a', target: 'b', weight: 2 },
      { source: 'b', target: 'c', weight: 1 },
    ];
    const positions = computeLayout(nodes, edges, 400, 300);
    for (const [, pos] of positions) {
      expect(pos.x).toBeGreaterThanOrEqual(0);
      expect(pos.x).toBeLessThanOrEqual(400);
      expect(pos.y).toBeGreaterThanOrEqual(0);
      expect(pos.y).toBeLessThanOrEqual(300);
    }
  });

  it('places a single node at the center', () => {
    const positions = computeLayout([{ tag: 'solo', count: 1 }], [], 400, 300);
    const pos = positions.get('solo')!;
    expect(pos.x).toBeCloseTo(200, 0);
    expect(pos.y).toBeCloseTo(150, 0);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/dashboard/__tests__/tagClusterLayout.test.ts`
Expected: FAIL（`src/dashboard/tagClusterLayout.ts` が存在しない）

- [ ] **Step 3: `computeLayout` を実装する**

```typescript
/**
 * tagClusterLayout.ts
 * Minimal force-directed layout: repulsion between all nodes + attraction along edges.
 * Not a general-purpose physics engine — sized for a few dozen tag nodes.
 */

import type { TagNode, TagEdge } from './tagCooccurrence.js';

export interface Position {
  x: number;
  y: number;
}

const ITERATIONS = 100;
const REPULSION = 4000;
const ATTRACTION = 0.02;
const DAMPING = 0.9;

export function computeLayout(
  nodes: TagNode[],
  edges: TagEdge[],
  width: number,
  height: number
): Map<string, Position> {
  const positions = new Map<string, Position>();
  const velocities = new Map<string, Position>();

  if (nodes.length === 0) {
    return positions;
  }

  if (nodes.length === 1) {
    positions.set(nodes[0].tag, { x: width / 2, y: height / 2 });
    return positions;
  }

  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) / 3;
  nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / nodes.length;
    positions.set(node.tag, {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    });
    velocities.set(node.tag, { x: 0, y: 0 });
  });

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const forces = new Map<string, Position>();
    nodes.forEach(n => forces.set(n.tag, { x: 0, y: 0 }));

    // Repulsion between every pair of nodes
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i].tag;
        const b = nodes[j].tag;
        const posA = positions.get(a)!;
        const posB = positions.get(b)!;
        const dx = posA.x - posB.x;
        const dy = posA.y - posB.y;
        const distSq = Math.max(dx * dx + dy * dy, 1);
        const force = REPULSION / distSq;
        const dist = Math.sqrt(distSq);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        forces.get(a)!.x += fx;
        forces.get(a)!.y += fy;
        forces.get(b)!.x -= fx;
        forces.get(b)!.y -= fy;
      }
    }

    // Attraction along edges
    for (const edge of edges) {
      const posA = positions.get(edge.source);
      const posB = positions.get(edge.target);
      if (!posA || !posB) continue;
      const dx = posB.x - posA.x;
      const dy = posB.y - posA.y;
      forces.get(edge.source)!.x += dx * ATTRACTION * edge.weight;
      forces.get(edge.source)!.y += dy * ATTRACTION * edge.weight;
      forces.get(edge.target)!.x -= dx * ATTRACTION * edge.weight;
      forces.get(edge.target)!.y -= dy * ATTRACTION * edge.weight;
    }

    // Apply forces with damping, then clamp to canvas bounds
    for (const node of nodes) {
      const vel = velocities.get(node.tag)!;
      const force = forces.get(node.tag)!;
      vel.x = (vel.x + force.x) * DAMPING;
      vel.y = (vel.y + force.y) * DAMPING;

      const pos = positions.get(node.tag)!;
      pos.x = Math.max(0, Math.min(width, pos.x + vel.x));
      pos.y = Math.max(0, Math.min(height, pos.y + vel.y));
    }
  }

  return positions;
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/dashboard/__tests__/tagClusterLayout.test.ts`
Expected: PASS（全4ケース）

- [ ] **Step 5: コミット**

```bash
git add src/dashboard/tagClusterLayout.ts src/dashboard/__tests__/tagClusterLayout.test.ts
git commit -m "feat(tag-cluster): 簡易force-directedレイアウト計算を実装"
```

---

### Task 4: `tagClusterPanel.ts` でSVG描画とノードクリック連動を実装する

**Files:**
- Create: `src/dashboard/tagClusterPanel.ts`
- Test: `src/dashboard/__tests__/tagClusterPanel.test.ts`（新規）

- [ ] **Step 1: 失敗させるテストを書く**

`src/dashboard/__tests__/tagClusterPanel.test.ts` を新規作成する:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initTagClusterPanel } from '../tagClusterPanel.js';
import * as dashboardSqliteService from '../dashboardSqliteService.js';

vi.mock('../dashboardSqliteService.js');

describe('tagClusterPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <svg id="tagClusterSvg" width="400" height="300"></svg>
      <div id="tagClusterEmptyState" hidden></div>
      <div id="tagClusterTruncatedNotice" hidden></div>
    `;
  });

  it('renders nodes as SVG circles when tagged entries exist', async () => {
    vi.spyOn(dashboardSqliteService, 'queryLogs').mockResolvedValue({
      rows: [{ id: 1, tags: '#tech #ai' } as never],
      total: 1,
    });

    await initTagClusterPanel();

    const svg = document.getElementById('tagClusterSvg')!;
    const circles = svg.querySelectorAll('circle');
    expect(circles.length).toBe(2);
  });

  it('shows empty state and does not throw when no tags exist', async () => {
    vi.spyOn(dashboardSqliteService, 'queryLogs').mockResolvedValue({ rows: [], total: 0 });

    await expect(initTagClusterPanel()).resolves.not.toThrow();

    const emptyState = document.getElementById('tagClusterEmptyState') as HTMLElement;
    expect(emptyState.hidden).toBe(false);
  });

  it('dispatches navigate-to-tag when a node is clicked', async () => {
    vi.spyOn(dashboardSqliteService, 'queryLogs').mockResolvedValue({
      rows: [{ id: 1, tags: '#tech' } as never],
      total: 1,
    });

    const handler = vi.fn();
    document.addEventListener('navigate-to-tag', handler);

    await initTagClusterPanel();

    const circle = document.querySelector('circle') as SVGCircleElement;
    circle.dispatchEvent(new Event('click', { bubbles: true }));

    expect(handler).toHaveBeenCalled();
    expect((handler.mock.calls[0][0] as CustomEvent).detail).toBe('tech');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/dashboard/__tests__/tagClusterPanel.test.ts`
Expected: FAIL（`src/dashboard/tagClusterPanel.ts` が存在しない）

- [ ] **Step 3: `tagClusterPanel.ts` を実装する**

```typescript
/**
 * tagClusterPanel.ts
 * Renders a tag cooccurrence graph (nodes + edges) as SVG in the dashboard.
 */

import { queryLogs } from './dashboardSqliteService.js';
import { computeTagCooccurrence, limitToTopNodes } from './tagCooccurrence.js';
import { computeLayout } from './tagClusterLayout.js';

const MAX_NODES = 50;
const SVG_NS = 'http://www.w3.org/2000/svg';

export async function initTagClusterPanel(): Promise<void> {
  const svg = document.getElementById('tagClusterSvg') as unknown as SVGSVGElement | null;
  const emptyState = document.getElementById('tagClusterEmptyState') as HTMLElement | null;
  const truncatedNotice = document.getElementById('tagClusterTruncatedNotice') as HTMLElement | null;
  if (!svg) return;

  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const result = await queryLogs({ limit: 10000 });
  const rows = result?.rows ?? [];

  const { nodes, edges } = computeTagCooccurrence(rows);

  if (nodes.length === 0) {
    if (emptyState) emptyState.hidden = false;
    if (truncatedNotice) truncatedNotice.hidden = true;
    return;
  }

  if (emptyState) emptyState.hidden = true;

  const limited = limitToTopNodes(nodes, edges, MAX_NODES);
  if (truncatedNotice) truncatedNotice.hidden = !limited.truncated;

  const width = svg.width.baseVal.value || 400;
  const height = svg.height.baseVal.value || 300;
  const positions = computeLayout(limited.nodes, limited.edges, width, height);

  for (const edge of limited.edges) {
    const a = positions.get(edge.source);
    const b = positions.get(edge.target);
    if (!a || !b) continue;
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', String(a.x));
    line.setAttribute('y1', String(a.y));
    line.setAttribute('x2', String(b.x));
    line.setAttribute('y2', String(b.y));
    line.setAttribute('class', 'tag-cluster-edge');
    line.setAttribute('stroke-width', String(Math.min(edge.weight, 5)));
    svg.appendChild(line);
  }

  for (const node of limited.nodes) {
    const pos = positions.get(node.tag);
    if (!pos) continue;
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', String(pos.x));
    circle.setAttribute('cy', String(pos.y));
    circle.setAttribute('r', String(4 + Math.min(node.count, 20)));
    circle.setAttribute('class', 'tag-cluster-node');
    circle.style.cursor = 'pointer';
    circle.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('navigate-to-tag', { detail: node.tag }));
    });

    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = `#${node.tag} (${node.count})`;
    circle.appendChild(title);

    svg.appendChild(circle);
  }
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/dashboard/__tests__/tagClusterPanel.test.ts`
Expected: PASS（全3ケース）

- [ ] **Step 5: コミット**

```bash
git add src/dashboard/tagClusterPanel.ts src/dashboard/__tests__/tagClusterPanel.test.ts
git commit -m "feat(tag-cluster): SVGグラフ描画とノードクリック連動を実装"
```

---

### Task 5: ダッシュボードにタグクラスタパネルを追加する

**Files:**
- Modify: `entrypoints/options/index.html`
- Modify: `src/dashboard/dashboard.ts`

- [ ] **Step 1: `entrypoints/options/index.html` にサイドナビとパネルを追加する**

既存のサイドナビ項目（例: `data-panel="panel-tags"`）のパターンに倣い、以下を追加する:

```html
<button class="nav-item" data-panel="panel-tag-cluster">タグクラスタ</button>
```

対応するパネルdivを追加する:

```html
<div id="panel-tag-cluster" class="panel" hidden>
  <h2>タグクラスタ</h2>
  <p>タグの共起関係をグラフで表示します。ノードをクリックすると該当タグの履歴に絞り込まれます。</p>
  <div id="tagClusterEmptyState" hidden>タグ付き履歴がまだありません。</div>
  <div id="tagClusterTruncatedNotice" hidden>タグ数が多いため、上位50件のみ表示しています。</div>
  <svg id="tagClusterSvg" width="800" height="600"></svg>
</div>
```

**注記:** 実装者は既存の `entrypoints/options/index.html` のナビ構造・`navigation.ts` のパネル切り替えロジックを確認し、既存パターンと矛盾しない形で挿入すること。

- [ ] **Step 2: `dashboard.ts` の初期化処理に `initTagClusterPanel()` を追加する**

`src/dashboard/dashboard.ts` の既存パネル初期化箇所（例: `initDiagnosticsPanel()` や `initTagsPanel()` の呼び出し箇所）に以下を追加する:

```typescript
import { initTagClusterPanel } from './tagClusterPanel.js';

// 既存の初期化呼び出し群に追加
initTagClusterPanel();
```

- [ ] **Step 3: 型チェックを実行する**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 4: コミット**

```bash
git add entrypoints/options/index.html src/dashboard/dashboard.ts
git commit -m "feat(dashboard): タグクラスタパネルをナビに追加"
```

---

### Task 6: 全体の型チェックとテストスイートを実行する

**Files:** なし（検証のみ）

- [ ] **Step 1: 型チェックを実行する**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 2: 全テストスイートを実行する**

Run: `npm test`
Expected: 全テストPASS（既存テストの回帰なし）

- [ ] **Step 3: `npm run validate` で最終確認する**

Run: `npm run validate`
Expected: 型チェック・テストともにPASS

---

## Definition of Done チェックリスト（PBI再掲）

- [x] tags カラムからタグ共起を集計する（Task 1）
- [x] グラフノード/エッジを描画する（Task 3, 4）
- [x] ノードクリックで履歴フィルタと連動する（Task 4）
- [x] タグ0件で例外を出さない（Task 1, 4のempty-stateハンドリング）
