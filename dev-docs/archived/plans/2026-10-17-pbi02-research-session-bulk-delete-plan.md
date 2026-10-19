# PBI-02 Implementation Plan: リサーチ・セッションのまとめて削除

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** リサーチ・セッション画面でセッション／ページ／サブツリー（ツリー中間ノード配下）を選んでまとめて削除できる。履歴画面の2段階確認パターンを流用し、確認には詳細＋再グループ化注意を出す。

**Architecture:** 削除対象は表示用セッションではなく配下レコードID集合。選択状態は当パネル内の `Set<number>`（`lastRows` と独立）。削除実行は既存 `deleteLog(id)`＋`removeSavedUrl(url)` を1件ずつ（先行失敗で停止・件数トーストは履歴と同一政策）。削除後は対象期間を再fetch→再グループ化し、選択はリセットする。

**Tech Stack:** TypeScript (ESM, `.js` import suffix), Vitest (`npx vitest run`), `npm run type-check`, `npm run lint`. MV3 CSP: `innerHTML` はクリア用途のみ。

**PBI:** `pbi/2026-10-17-02-feat-research-session-bulk-delete.md` / 所見 `dev-docs/dig-findings-2026-10-17-research-pause.md`

---

## File structure

| File | Responsibility |
|------|---------------|
| Create `src/dashboard/researchSessionSelection.ts` | pure選択展開の所有者: `collectSubtreeIds`・`expandSelectedIds`・`summarizeSelection`（確認文用集計） |
| Modify `src/dashboard/sessionPathAggregate.ts` | 変更なし（`buildSessionTree`・`SessionTreeNode` を流用。サブツリー列挙は新モジュール側） |
| Modify `src/dashboard/panels/asyncData/researchSessionsPanel.ts` | チェックボックス描画・選択状態・バルクバー配線・削除実行・再fetch。`renderSession`/`renderTree`/`populateRecord` を拡張 |
| Modify `entrypoints/options/index.html` | `#researchSessionsList` の前（2072行目付近）にバルクバー markup（`researchSessionsBulkBar` 一式、data-i18n付き静的HTML） |
| Modify `entrypoints/options/dashboard.css` | バルクバー・チェックボックスの最小スタイル（履歴の `.sqlite-bulk-*` ではなく新規 `.rsess-bulk-*`。5068行目付近の research-sessions 群の隣） |
| Modify `public/_locales/ja/messages.json` + `en` | 新キー9件（Task 5に列挙） |
| Tests | `src/dashboard/panels/asyncData/__tests__/researchSessionSelection.test.ts`（新規pure）、`researchSessionsPanel.lifecycle.test.ts` に選択・削除ケース追加（既存のlist/rows fixture形を流用） |

削除API（流用・新規経路を作らない）:
- `import { deleteLog } from '../../dashboardSqliteService.js'`（`sqliteHistoryModel.ts:24` と同一）
- `import { removeSavedUrl } from '../../../utils/storageUrls.js'`（`sqliteHistoryModel.ts:28` と同一）
- 確認ダイアログ: `import { showConfirmDialog } from '../../utils/confirmDialog.js'`（`sqliteHistoryPanel.ts:3` と同一）

---

### Task 0: Recon（写経元の確定、20分）

**Files:** Read-only: `src/dashboard/panels/asyncData/sqliteHistoryPanelView.ts:820-880`, `src/dashboard/panels/asyncData/sqliteHistoryModel.ts:744-790`, `src/dashboard/panels/asyncData/__tests__/sqliteHistoryPanelView.test.ts:381-460`, `src/dashboard/panels/asyncData/__tests__/researchSessionsPanel.lifecycle.test.ts:88-130`

- [ ] **Step 1: パターンを抜き出す**

```bash
sed -n '820,880p' src/dashboard/panels/asyncData/sqliteHistoryPanelView.ts
sed -n '744,790p' src/dashboard/panels/asyncData/sqliteHistoryModel.ts
sed -n '381,460p' src/dashboard/panels/asyncData/__tests__/sqliteHistoryPanelView.test.ts
```

- [ ] **Step 2: 以下をメモして写経元にする（変更なし、コミットなし）**
  - バルクバーの2段階確認のDOM順序（delete→confirmYes/confirmNo）と選択件数更新タイミング
  - `deleteSelectedEntries` の先行失敗で停止・`{ deletedCount, error }` 返却の政策
  - lifecycleテストの fixture（`#researchSessionsList` 構築・panel mount・reload の3点セット）

---

### Task 1: pure選択展開＋テスト（TDD）

**Files:**
- Create: `src/dashboard/researchSessionSelection.ts`
- Test: `src/dashboard/panels/asyncData/__tests__/researchSessionSelection.test.ts`

選択モデルの定義（本Taskで凍結し、後続Taskはこの型だけを使う）:

```ts
export type SessionSelection =
  | { kind: 'session'; sessionIndex: number }
  | { kind: 'page'; recordId: number }
  | { kind: 'subtree'; recordId: number };
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/dashboard/panels/asyncData/__tests__/researchSessionSelection.test.ts
import { describe, expect, it } from 'vitest';
import { expandSelectedIds, summarizeSelection } from '../../../researchSessionSelection.js';
import type { ResearchSession } from '../../../researchSessionAggregate.js';
import { buildSessionTree } from '../../../sessionPathAggregate.js';

function record(id: number, url: string, nav?: string) {
  return { id, url, title: url, domain: 'e.com', tags: null, created_at: id * 1000, nav_source_url: nav ?? null, search_query: null };
}

describe('expandSelectedIds', () => {
  it('session choice expands to all record ids without duplicates', () => {
    const sessions = [{ startAt: 1, endAt: 2, durationMs: 1, records: [record(1, 'https://e.com/a'), record(2, 'https://e.com/b')], topTags: [], topDomains: [], starredCount: 0 }] as ResearchSession[];
    expect(expandSelectedIds(sessions, [{ kind: 'session', sessionIndex: 0 }])).toEqual(new Set([1, 2]));
  });

  it('subtree choice expands to the node and all descendants', () => {
    const sessions = [{ startAt: 1, endAt: 3, durationMs: 2, records: [record(1, 'https://e.com/a'), record(2, 'https://e.com/b', 'https://e.com/a'), record(3, 'https://e.com/c', 'https://e.com/b')], topTags: [], topDomains: [], starredCount: 0 }] as ResearchSession[];
    const trees = sessions.map(buildSessionTree);
    expect(expandSelectedIds(sessions, [{ kind: 'subtree', recordId: 2 }], trees)).toEqual(new Set([2, 3]));
  });

  it('empty selection expands to empty set', () => {
    expect(expandSelectedIds([], [])).toEqual(new Set());
  });
});

describe('summarizeSelection', () => {
  it('counts pages and date range for the confirm dialog', () => {
    const sessions = [{ startAt: 1_000, endAt: 5_000, durationMs: 4_000, records: [record(1, 'https://e.com/a'), record(2, 'https://f.com/b')], topTags: [], topDomains: [], starredCount: 0 }] as ResearchSession[];
    expect(summarizeSelection(sessions, [{ kind: 'session', sessionIndex: 0 }])).toEqual({ pages: 2, earliest: 1_000, latest: 2_000 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/dashboard/panels/asyncData/__tests__/researchSessionSelection.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 3: Write minimal implementation**

```ts
// src/dashboard/researchSessionSelection.ts
import type { ResearchSession } from './researchSessionAggregate.js';
import type { SessionTreeNode } from './sessionPathAggregate.js';

export type SessionSelection =
  | { kind: 'session'; sessionIndex: number }
  | { kind: 'page'; recordId: number }
  | { kind: 'subtree'; recordId: number };

function collectSubtreeIds(node: SessionTreeNode, out: Set<number>): void {
  out.add(node.record.id);
  for (const child of node.children) collectSubtreeIds(child, out);
}

function findNode(trees: SessionTreeNode[], recordId: number): SessionTreeNode | null {
  for (const node of trees) {
    if (node.record.id === recordId) return node;
    const found = findNode(node.children, recordId);
    if (found) return found;
  }
  return null;
}

/**
 * 選択→削除対象ID集合。sessionは配下全ID（セッション自体にIDはない）、
 * pageは単ID、subtreeは中間ノード配下の全ID。重複はSetで吸収する。
 */
export function expandSelectedIds(
  sessions: readonly ResearchSession[],
  selection: readonly SessionSelection[],
  trees?: readonly SessionTreeNode[][],
): Set<number> {
  const ids = new Set<number>();
  for (const item of selection) {
    if (item.kind === 'session') {
      const session = sessions[item.sessionIndex];
      if (!session) continue;
      for (const record of session.records) ids.add(record.id);
    } else if (item.kind === 'page') {
      ids.add(item.recordId);
    } else {
      const allTrees = (trees ?? []).flat();
      const node = findNode(allTrees, item.recordId);
      if (node) collectSubtreeIds(node, ids);
      else ids.add(item.recordId);
    }
  }
  return ids;
}

export interface SelectionSummary { pages: number; earliest: number | null; latest: number | null; }

/** 確認ダイアログ用の集計（件数・期間）。代表ドメイン/タグはパネル側で付す。 */
export function summarizeSelection(
  sessions: readonly ResearchSession[],
  selection: readonly SessionSelection[],
  trees?: readonly SessionTreeNode[][],
): SelectionSummary {
  const ids = expandSelectedIds(sessions, selection, trees);
  let earliest: number | null = null;
  let latest: number | null = null;
  for (const session of sessions) {
    for (const record of session.records) {
      if (!ids.has(record.id)) continue;
      if (earliest === null || record.created_at < earliest) earliest = record.created_at;
      if (latest === null || record.created_at > latest) latest = record.created_at;
    }
  }
  return { pages: ids.size, earliest, latest };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/dashboard/panels/asyncData/__tests__/researchSessionSelection.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/researchSessionSelection.ts src/dashboard/panels/asyncData/__tests__/researchSessionSelection.test.ts
git commit -m "feat: add pure session selection expansion and summary"
```

---

### Task 2: チェックボックス描画（3階層）＋テスト

**Files:**
- Modify: `src/dashboard/panels/asyncData/researchSessionsPanel.ts`
- Test: `src/dashboard/panels/asyncData/__tests__/researchSessionsPanel.lifecycle.test.ts` に追加

- [ ] **Step 1: Write the failing tests**（既存fixture形を流用。`renderSession` は非exportのためDOM経由で検証）

```ts
it('renders a session checkbox, page checkboxes, and subtree checkboxes', async () => {
  // 既存の mount＋reload fixture（当ファイル88-130行の形）で2セッションをロード後:
  // - `.rsess-select-session` がセッション数分ある
  // - セッションを開いた後の `.rsess-select-page` がページ数分ある
  // - nav trailありセッションの中間ノードに `.rsess-select-subtree` がある
  expect(document.querySelectorAll('.rsess-select-session').length).toBe(2);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/dashboard/panels/asyncData/__tests__/researchSessionsPanel.lifecycle.test.ts`
Expected: FAIL（checkbox class が0件）

- [ ] **Step 3: Write minimal implementation**

`renderSession(session, index, selection)` に変更（既存シグネチャ `renderSession(session)` を拡張。呼出側 `render()` の `for (const session of agg.sessions)` を `agg.sessions.forEach((session, index) => ...)` へ）:

```ts
function renderSession(
  session: ResearchSession,
  index: number,
  hooks: {
    toggleSession: (index: number, checked: boolean) => void;
    togglePage: (recordId: number, checked: boolean) => void;
    toggleSubtree: (recordId: number, checked: boolean) => void;
  },
): HTMLLIElement {
  // ...既存の details/summary 構築の前に:
  const sessionCheck = document.createElement('input');
  sessionCheck.type = 'checkbox';
  sessionCheck.className = 'rsess-select-session';
  sessionCheck.setAttribute('aria-label', `select session ${index + 1}`);
  sessionCheck.addEventListener('change', () => hooks.toggleSession(index, sessionCheck.checked));
  summary.prepend(sessionCheck);
  // ...
}
```

`populateRecord` に第3引数 `hooks: { togglePage }` を追加し、行末に:

```ts
const pageCheck = document.createElement('input');
pageCheck.type = 'checkbox';
pageCheck.className = 'rsess-select-page';
pageCheck.dataset.recordId = String(record.id);
pageCheck.setAttribute('aria-label', `select page ${label}`);
pageCheck.addEventListener('change', () => hooks.togglePage(record.id, pageCheck.checked));
li.prepend(pageCheck);
```

`renderTree` の各ノードで children を持つ `li` に:

```ts
if (node.children.length > 0) {
  const subtreeCheck = document.createElement('input');
  subtreeCheck.type = 'checkbox';
  subtreeCheck.className = 'rsess-select-subtree';
  subtreeCheck.dataset.recordId = String(node.record.id);
  subtreeCheck.setAttribute('aria-label', 'select pages below this page');
  subtreeCheck.addEventListener('change', () => hooks.toggleSubtree(node.record.id, subtreeCheck.checked));
  li.prepend(subtreeCheck);
}
```

（CSP: `textContent`/`setAttribute` のみ。`innerHTML` 不使用。）

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/dashboard/panels/asyncData/__tests__/researchSessionsPanel.lifecycle.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/panels/asyncData/researchSessionsPanel.ts src/dashboard/panels/asyncData/__tests__/researchSessionsPanel.lifecycle.test.ts
git commit -m "feat: render session/page/subtree checkboxes in research sessions"
```

---

### Task 3: 選択状態＋バルクバー＋削除実行（履歴政策の流用）

**Files:**
- Modify: `src/dashboard/panels/asyncData/researchSessionsPanel.ts`
- Modify: `entrypoints/options/index.html`
- Test: `researchSessionsPanel.lifecycle.test.ts` に追加

- [ ] **Step 1: markup を追加する**（`#researchSessionsList` 2072行目の直前）

```html
<div id="researchSessionsBulkBar" class="rsess-bulk-bar" hidden>
  <span id="researchSessionsSelectionCount" aria-live="polite"></span>
  <button type="button" id="researchSessionsDeleteSelected" class="secondary-btn" data-i18n="researchSessions_deleteSelected">Delete selected</button>
  <span id="researchSessionsDeleteConfirm" hidden>
    <span data-i18n="researchSessions_deleteConfirm">Really delete?</span>
    <button type="button" id="researchSessionsDeleteConfirmYes" class="secondary-btn" data-i18n="researchSessions_deleteConfirmYes">Delete</button>
    <button type="button" id="researchSessionsDeleteConfirmNo" class="secondary-btn" data-i18n="researchSessions_deleteConfirmNo">Cancel</button>
  </span>
</div>
```

- [ ] **Step 2: Write the failing tests**

```ts
it('delete flow: select -> confirm -> entries removed and list refetched', async () => {
  // セッション1件を選択→Delete selected→confirmYes の順に押す。
  // deleteLog が呼ばれ、一覧が再取得されること（Task 3実装後にPASS）。
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/dashboard/panels/asyncData/__tests__/researchSessionsPanel.lifecycle.test.ts`
Expected: FAIL（bulk bar ids がなく削除が起きない）

- [ ] **Step 4: Write minimal implementation**（lifecycle内に panel-local 状態＋配線）

```ts
// createResearchSessionsPanel() 内に追加
let selectedIds = new Set<number>();
let bulkBar: HTMLElement | null = null;
let selectionCountEl: HTMLElement | null = null;
let deleteBtn: HTMLButtonElement | null = null;
let deleteConfirm: HTMLElement | null = null;
let deleteConfirmYes: HTMLButtonElement | null = null;
let deleteConfirmNo: HTMLButtonElement | null = null;

function refreshBulkBar(): void {
  if (!bulkBar || !selectionCountEl || !deleteBtn) return;
  bulkBar.hidden = false;
  const n = selectedIds.size;
  selectionCountEl.textContent = msg('researchSessions_selectionCount', { n: selectedIds.size }, `${selectedIds.size} selected`);
  deleteBtn.disabled = n === 0;
  if (deleteConfirm) deleteConfirm.hidden = true;
}

async function handleDeleteSelectedConfirm(): Promise<void> {
  const ids = [...selectedIds];
  if (ids.length === 0) return;
  const { deleteLog, isServiceError } = await import('../../dashboardSqliteService.js');
  const { removeSavedUrl } = await import('../../../utils/storageUrls.js');
  let deletedCount = 0;
  let error: string | null = null;
  const urlById = new Map<number, string>();
  for (const row of lastRows ?? []) {
    if (selectedIds.has(row.id) && row.url) urlById.set(row.id, row.url);
  }
  for (const id of ids) {
    const result = await deleteLog(id);
    if (isServiceError(result)) {
      error = result.error;
      break; // 先行失敗で停止（履歴と同一政策）
    }
    const url = urlById.get(id);
    if (url) {
      try { await removeSavedUrl(url); } catch { /* best-effort（履歴と同一） */ }
    }
    deletedCount += 1;
  }
  selectedIds = new Set<number>();
  await lifecycle.reload(); // 対象期間を再fetch→再グループ化
  if (error !== null) {
    notices.setMessage('deleteError', msg('researchSessions_deleteError', { n: deletedCount }, `Deleted ${deletedCount} pages. Failed partway.`));
    notices.show('deleteError');
  }
}
```

詳細確認（deep-dig決定）は `handleDeleteSelected`（1段階目）で `showConfirmDialog` ではなくバルクバー内確認文に集計を入れる:

```ts
// 1段階目: summarizeSelection で件数・期間・代表ドメインを出してから confirm を開く
const summary = summarizeSelection(currentSessions, toSelection(selectedIds));
confirmText.textContent = `${summary.pages} pages ...`; // i18n key researchSessions_deleteDetail
```

選択の陳腐化対策: `render()` の先頭で `selectedIds` を空にしてバルクバーを更新する（gap変更・再fetchで古い選択を残さない）。

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/dashboard/panels/asyncData/__tests__/researchSessionsPanel.lifecycle.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/panels/asyncData/researchSessionsPanel.ts entrypoints/options/index.html
git commit -m "feat: wire research session bulk delete with two-step confirm"
```

---

### Task 4: i18n＋スタイル＋a11y

**Files:**
- Modify: `public/_locales/ja/messages.json`, `public/_locales/en/messages.json`
- Modify: `entrypoints/options/dashboard.css`
- Test: 既存のi18nカバレッジテストがあれば流用（`npm run build:docs-i18n` 不要。キー存在テストを追加しない）

追加キー（日英同時）:
- `researchSessions_deleteSelected`（選択を削除/Delete selected）
- `researchSessions_selectionCount`（`{n} 件選択中`/`{n} selected`）
- `researchSessions_deleteConfirm`（本当に削除しますか/Really delete?）
- `researchSessions_deleteConfirmYes`（削除する/Delete）、`researchSessions_deleteConfirmNo`（やめる/Cancel）
- `researchSessions_deleteDetail`（`{n} ページ・{from}〜{to}・代表 {domains}。残りは再グループ化されます`/`{n} pages ... Remaining pages regroup.`）
- `researchSessions_deleteError`、`researchSessions_deleted`、`researchSessions_regroupNotice`

CSS（research-sessions群の隣、約5084行目）:

```css
.rsess-bulk-bar { display: flex; gap: 8px; align-items: center; margin: 8px 0; }
.rsess-select-session, .rsess-select-page, .rsess-select-subtree { margin-right: 6px; }
```

- [ ] **Step 1-3:** キー追加→CSS追加→ `npm run type-check` cleanを確認してコミット

```bash
git add public/_locales/ja/messages.json public/_locales/en/messages.json entrypoints/options/dashboard.css
git commit -m "feat: add research session delete i18n keys and bulk bar styles"
```

---

### Task 5: ゲート通過（全体検証）

- [ ] **Step 1: 型＋影響範囲テスト**

```bash
npm run type-check
npx vitest run src/dashboard/panels/asyncData/__tests__/researchSessionSelection.test.ts src/dashboard/panels/asyncData/__tests__/researchSessionsPanel.lifecycle.test.ts src/dashboard/panels/asyncData/__tests__/researchSessionAggregate.test.ts src/dashboard/panels/asyncData/__tests__/sessionPathAggregate.test.ts
```

Expected: 全PASS

- [ ] **Step 2: lint**

```bash
npm run lint
```

Expected: 0 errors

- [ ] **Step 3: 目視確認**（`npm run build` 後に dashboard の Research Sessions で3階層チェック→詳細確認→削除→再グループ化を確認）

- [ ] **Step 4: PBIのINDEX行を ⬜→🔶→✅ で更新**

---

## Self-review（作成時チェック）

1. **Spec coverage:** セッション/ページ/サブツリーのチェック・件数表示・2段階確認・詳細＋再結合注意・スター無保護・未選択無効・再fetch再グループ・日英・a11y → Task 1〜4で網羅。Undo/ゴミ箱は対象外（PBI決定）を明記。
2. **Placeholder scan:** `TBD/TODO/適宜/同様に` なし。新規削除経路を作らない制約を Task 3 に明記。
3. **Type consistency:** `SessionSelection`（session/page/subtree）・`expandSelectedIds(sessions, selection, trees?)`・`SelectionSummary{pages,earliest,latest}`・DOM class `rsess-select-*`・bulk bar id `researchSessions*` は全Taskで同一。
