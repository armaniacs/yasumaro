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
