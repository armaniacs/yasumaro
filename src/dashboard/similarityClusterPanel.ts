/**
 * similarityClusterPanel.ts
 *
 * Cluster display panel wiring (PBI 2026-10-22-03, slice: panel).
 * Renders buildSimilarityClusters() output as a cancellable, non-destructive
 * list: cluster heading (member count + freshest date + media) followed by
 * per-member rows (title, domain, link). Pure model builder
 * (buildClusterPanelModel) is DOM-free and unit-tested; the DOM renderer
 * (renderClusterPanel) writes textContent/setAttribute only (MV3 CSP: never
 * innerHTML) and checks isStale() after every await so a superseded load
 * never overwrites a newer render (cancellable ops). Dismissing the panel
 * only clears its own container: source records are only read, never
 * written (クラスタ操作は取り消し可能で元記録を壊さない).
 */

import {
  buildSimilarityClusters,
  type SimilarityCluster,
  type SimilarityRecord,
} from './similarityClusterAggregate.js';
import { getUserLocale } from '../utils/localeUtils.js';

export interface SimilarityClusterPanelMember {
  id: number;
  title: string;
  url: string;
  domain: string;
  createdAt: number;
}

export interface SimilarityClusterPanelItem {
  memberCount: number;
  freshestAt: number;
  domains: string[];
  members: SimilarityClusterPanelMember[];
}

export interface SimilarityClusterPanelModel {
  items: SimilarityClusterPanelItem[];
  /** Reason shown instead of clusters when the set degenerates. */
  emptyReason: string;
}

export function buildClusterPanelModel(records: SimilarityRecord[]): SimilarityClusterPanelModel {
  const clusters: SimilarityCluster[] = buildSimilarityClusters(records);
  if (clusters.length === 0) {
    const hasTitle = records.some((record) => record.title.trim() !== '');
    return {
      items: [],
      emptyReason: hasTitle
        ? 'No similar groups yet: every story stands alone.'
        : 'No titles to compare in this period. Try a wider range.',
    };
  }
  return {
    items: clusters.map((cluster) => ({
      memberCount: cluster.members.length,
      freshestAt: cluster.freshestAt,
      domains: [...cluster.domains],
      members: cluster.members.map((member) => ({
        id: member.id,
        title: member.title,
        url: member.url,
        domain: member.domain,
        createdAt: member.createdAt,
      })),
    })),
    emptyReason: '',
  };
}

export interface ClusterPanelRenderHosts {
  list: HTMLElement;
  emptyState: HTMLElement;
}

/**
 * Renders a frozen model into the panel hosts. Synchronous DOM writes only;
 * cancellation is the caller's isStale() check before calling (the fetch
 * path awaits, then checks, then renders). Clearing the list (dismiss) drops
 * only rendered nodes; the input records were copied into the model.
 */
export function renderClusterPanel(
  hosts: ClusterPanelRenderHosts,
  model: SimilarityClusterPanelModel,
): void {
  while (hosts.list.firstChild) hosts.list.removeChild(hosts.list.firstChild);
  if (model.items.length === 0) {
    hosts.emptyState.textContent = model.emptyReason;
    hosts.emptyState.hidden = false;
    hosts.list.hidden = true;
    return;
  }
  hosts.emptyState.hidden = true;
  hosts.list.hidden = false;
  for (const item of model.items) {
    const section = document.createElement('section');
    const heading = document.createElement('h3');
    heading.textContent =
      `${item.memberCount} articles - ${item.domains.join(', ')} - ${new Date(item.freshestAt).toLocaleDateString(getUserLocale())}`;
    section.appendChild(heading);
    const list = document.createElement('ul');
    for (const member of item.members) {
      const row = document.createElement('li');
      // Stored URLs are attacker-influenced (visited-page URLs): only
      // http(s) becomes a link; anything else (javascript:, data:, ...)
      // renders as inert text so a crafted record cannot script the
      // dashboard origin on click.
      if (/^https?:\/\//iu.test(member.url)) {
        const link = document.createElement('a');
        link.textContent = member.title;
        link.setAttribute('href', member.url);
        link.setAttribute('rel', 'noopener noreferrer');
        row.appendChild(link);
      } else {
        row.textContent = member.title;
      }
      const meta = document.createElement('span');
      meta.textContent = ` (${member.domain})`;
      row.appendChild(meta);
      list.appendChild(row);
    }
    section.appendChild(list);
    hosts.list.appendChild(section);
  }
}
