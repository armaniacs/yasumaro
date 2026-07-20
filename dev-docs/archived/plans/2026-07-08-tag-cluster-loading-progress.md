# Tag Cluster ローディング進捗表示 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tag Cluster パネルの初回読み込み時に、SVG グラフ中央に 4段階のローディング進捗を表示し、ユーザーに何が起こっているかを明確に伝える。

**Architecture:** `tagClusterPanel.ts` に新しいローディング UI マネージャーを追加し、各処理段階（データ読み込み、ノード分析、レイアウト計算、グラフ描画）の完了時に進捗を更新。SVG 中央にオーバーレイ要素を作成し、段階的にステップを表示・更新する。

**Tech Stack:** TypeScript、SVG DOM manipulation、Chrome extension APIs

---

## ファイル構造

**修正ファイル:**
- `src/dashboard/tagClusterPanel.ts` — ローディング UI ロジックを追加

**新規ファイル:**
- `src/dashboard/tagClusterLoading.ts` — ローディング UI を管理する専用モジュール

---

## Task 1: ローディング UI マネージャーモジュールの作成

**Files:**
- Create: `src/dashboard/tagClusterLoading.ts`

- [ ] **Step 1: ローディング UI 管理モジュールを作成**

```typescript
/**
 * Tag Cluster loading UI management
 */

interface LoadingStep {
  number: number;
  label: string;
  completed: boolean;
}

export class TagClusterLoadingManager {
  private svgElement: SVGSVGElement | null = null;
  private overlayGroup: SVGGElement | null = null;
  private currentStep: number = 0;
  private steps: LoadingStep[] = [
    { number: 1, label: 'データ読み込み', completed: false },
    { number: 2, label: 'ノード分析', completed: false },
    { number: 3, label: 'レイアウト計算', completed: false },
    { number: 4, label: 'グラフ描画', completed: false },
  ];

  constructor(svgElement: SVGSVGElement) {
    this.svgElement = svgElement;
  }

  /**
   * Show loading UI with initial step
   */
  show(): void {
    if (!this.svgElement) return;

    // Clear any existing overlay
    this.cleanup();

    // Create overlay group
    this.overlayGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.overlayGroup.setAttribute('class', 'tag-cluster-loading-overlay');

    // Create background rectangle
    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bgRect.setAttribute('width', this.svgElement.getAttribute('width') || '400');
    bgRect.setAttribute('height', this.svgElement.getAttribute('height') || '300');
    bgRect.setAttribute('fill', 'rgba(0, 0, 0, 0.3)');
    this.overlayGroup.appendChild(bgRect);

    // Create text container
    const textGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    textGroup.setAttribute('class', 'tag-cluster-loading-text');
    this.overlayGroup.appendChild(textGroup);

    this.svgElement.appendChild(this.overlayGroup);
    this.updateStep(0);
  }

  /**
   * Update to next step
   */
  updateStep(stepIndex: number): void {
    if (stepIndex < 0 || stepIndex >= this.steps.length) return;

    this.currentStep = stepIndex;
    this.steps[stepIndex].completed = true;
    this.render();
  }

  /**
   * Render current loading UI
   */
  private render(): void {
    const textGroup = this.overlayGroup?.querySelector('.tag-cluster-loading-text') as SVGGElement;
    if (!textGroup) return;

    // Clear existing text
    while (textGroup.firstChild) {
      textGroup.removeChild(textGroup.firstChild);
    }

    const svgHeight = parseInt(this.svgElement?.getAttribute('height') || '300');
    const startY = (svgHeight - 100) / 2;

    // Render all steps
    this.steps.forEach((step, idx) => {
      const yOffset = idx * 35;
      const isCompleted = step.completed;
      const isCurrent = idx === this.currentStep;

      // Step marker (✓ or ○)
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      marker.setAttribute('x', '180');
      marker.setAttribute('y', String(startY + yOffset));
      marker.setAttribute('font-size', '16');
      marker.setAttribute('font-weight', 'bold');
      marker.setAttribute('fill', isCompleted ? '#10b981' : isCurrent ? '#3b82f6' : '#9ca3af');
      marker.textContent = isCompleted ? '✓' : '◯';
      textGroup.appendChild(marker);

      // Step number and label
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', '210');
      label.setAttribute('y', String(startY + yOffset + 5));
      label.setAttribute('font-size', '14');
      label.setAttribute('fill', isCompleted ? '#10b981' : isCurrent ? '#3b82f6' : '#9ca3af');
      label.textContent = `${step.number}/4: ${step.label}`;
      textGroup.appendChild(label);
    });
  }

  /**
   * Hide and clean up loading UI
   */
  cleanup(): void {
    if (this.overlayGroup && this.overlayGroup.parentNode) {
      this.overlayGroup.parentNode.removeChild(this.overlayGroup);
    }
    this.overlayGroup = null;
    this.steps.forEach(step => (step.completed = false));
    this.currentStep = 0;
  }
}
```

- [ ] **Step 2: ファイルを保存**

```bash
# No commit yet - wait for integration
```

---

## Task 2: tagClusterPanel.ts への統合

**Files:**
- Modify: `src/dashboard/tagClusterPanel.ts:1-50`
- Modify: `src/dashboard/tagClusterPanel.ts:22-132` (initTagClusterPanel 関数)

- [ ] **Step 1: インポートを追加**

ファイルの先頭に以下を追加：

```typescript
import { TagClusterLoadingManager } from './tagClusterLoading.js';
```

- [ ] **Step 2: initTagClusterPanel 関数を修正 - ローディング初期化**

`initTagClusterPanel` 関数の最初（コメント直後）に以下を追加：

```typescript
export async function initTagClusterPanel(): Promise<void> {
  console.log('[tagClusterPanel] initTagClusterPanel START');
  const svg = document.getElementById('tagClusterSvg') as unknown as SVGSVGElement | null;
  const emptyState = document.getElementById('tagClusterEmptyState') as HTMLElement | null;
  const truncatedNotice = document.getElementById('tagClusterTruncatedNotice') as HTMLElement | null;
  console.log('[tagClusterPanel] svg:', !!svg, 'emptyState:', !!emptyState);
  if (!svg) {
    console.log('[tagClusterPanel] SVG element not found, returning');
    return;
  }

  while (svg.firstChild) svg.removeChild(svg.firstChild);

  // Initialize loading manager
  const loadingManager = new TagClusterLoadingManager(svg);
  loadingManager.show();

  try {
    console.log('[tagClusterPanel] calling queryLogs...');
    const result = await queryLogs({ limit: 10000 });
    const rows = result?.rows ?? [];
    console.log('[tagClusterPanel] queryLogs result rows:', rows.length);

    loadingManager.updateStep(0); // Step 1 complete
```

- [ ] **Step 3: ノード分析後にステップ更新を追加**

`computeTagCooccurrence(rows)` 呼び出しの直後に以下を追加：

```typescript
    const { nodes, edges } = computeTagCooccurrence(rows);
    console.log('[tagClusterPanel] computeTagCooccurrence nodes:', nodes.length, 'edges:', edges.length);

    loadingManager.updateStep(1); // Step 2 complete

    if (nodes.length === 0) {
```

- [ ] **Step 4: レイアウト計算後にステップ更新を追加**

`limitToTopNodes(nodes, edges, MAX_NODES)` と `computeLayout()` の呼び出し後に以下を追加：

```typescript
    const limited = limitToTopNodes(nodes, edges, MAX_NODES);
    if (truncatedNotice) truncatedNotice.hidden = !limited.truncated;

    let width = 400;
    let height = 300;
    // ... (既存のサイズ取得コード)

    const positions = computeLayout(limited.nodes, limited.edges, width, height);

    loadingManager.updateStep(2); // Step 3 complete

    for (const edge of limited.edges) {
```

- [ ] **Step 5: グラフ描画完了後にローディング UI を非表示**

ループの完了後（最後のノード追加後）に以下を追加：

```typescript
    for (const node of limited.nodes) {
      // ... (既存のノード描画コード)
    }

    loadingManager.updateStep(3); // Step 4 complete
    loadingManager.cleanup(); // Remove loading UI
  } catch (error) {
    loadingManager.cleanup(); // Clean up on error
    console.error('[tagClusterPanel] error:', error);
  }
}
```

- [ ] **Step 6: 変更を確認して実行**

```bash
# 確認用：tagClusterPanel.ts の最初と最後を見て、統合が正しいか確認
head -20 src/dashboard/tagClusterPanel.ts
```

- [ ] **Step 7: テストビルド**

```bash
npm run build:watch
```

ビルドが成功することを確認。

- [ ] **Step 8: Chrome 拡張機能をリロード**

Chrome Extensions ページで拡張機能をリロード。

- [ ] **Step 9: Tag Cluster パネルで動作確認**

ダッシュボードを開き、Tag Cluster パネルをクリック。以下を確認：
- SVG 中央に 4段階のローディング表示が出現
- 各ステップが順序通り完了する
- グラフ描画完了後にローディング UI が消える

- [ ] **Step 10: Commit**

```bash
git add src/dashboard/tagClusterLoading.ts src/dashboard/tagClusterPanel.ts
git commit -m "feat: add 4-step loading progress display to Tag Cluster panel

- Show loading UI with progress steps when initializing Tag Cluster
- Steps: Data Loading → Node Analysis → Layout Calculation → Graph Rendering
- Visual feedback with checkmarks for completed steps
- Auto-hide loading UI when graph rendering completes

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```
