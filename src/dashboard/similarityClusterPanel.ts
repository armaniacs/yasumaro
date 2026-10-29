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
 *
 * createSimilarityClusterPanel is the catalog factory (PBI 2026-09-07-25
 * registration): fetch (fetchPeriodRows, the shared dashboard read seam)
 * → isStale → render, following the asyncDataPanelLifecycle reload
 * skeleton. The empty reason stays panel-owned: the model returns a stable
 * reason kind, the factory maps it to the locale message.
 */

import {
  buildSimilarityClusters,
  type SimilarityCluster,
  type SimilarityRecord,
} from './similarityClusterAggregate.js';
import { getUserLocale } from '../utils/localeUtils.js';
import { MAX_QUERY_ROWS } from '../utils/computeLimits.js';
import { getMessageOr } from '../utils/i18n.js';
import { fetchPeriodRows } from './panels/fetchPeriodRows.js';
import { createAsyncDataPanelLifecycle } from './panels/asyncData/asyncDataPanelLifecycle.js';
import { type PanelLifecycle } from './panels/types.js';

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
  /**
   * Which degenerate case produced the empty reason, so the factory can map
   * it to the locale message (the model stays DOM- and i18n-free). null when
   * clusters are rendered.
   */
  emptyReasonKey: ClusterPanelEmptyReason | null;
}

/** The two degenerate cases of buildClusterPanelModel, as stable kinds. */
export type ClusterPanelEmptyReason = 'noSimilarGroups' | 'noTitles';

/** i18n message keys per empty reason (the factory owns the mapping). */
const EMPTY_REASON_MESSAGE_KEYS: Record<ClusterPanelEmptyReason, string> = {
  noSimilarGroups: 'similarityClusterEmpty',
  noTitles: 'similarityClusterEmptyNoTitles',
};

export function buildClusterPanelModel(records: SimilarityRecord[]): SimilarityClusterPanelModel {
  const clusters: SimilarityCluster[] = buildSimilarityClusters(records);
  if (clusters.length === 0) {
    const hasTitle = records.some((record) => record.title.trim() !== '');
    return {
      items: [],
      emptyReason: hasTitle
        ? 'No similar groups yet: every story stands alone.'
        : 'No titles to compare in this period. Try a wider range.',
      emptyReasonKey: hasTitle ? 'noSimilarGroups' : 'noTitles',
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
    emptyReasonKey: null,
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

/** Maps the model's stable empty-reason kind to the locale message. */
function localizeEmptyReason(model: SimilarityClusterPanelModel): SimilarityClusterPanelModel {
  const key = model.emptyReasonKey;
  if (key === null) return model;
  return { ...model, emptyReason: getMessageOr(EMPTY_REASON_MESSAGE_KEYS[key], model.emptyReason) };
}

/**
 * Catalog factory for the similarity-cluster panel (PBI 2026-10-22-03,
 * slice: panel registration). The reload skeleton is the shared
 * asyncDataPanelLifecycle (seq guard, stale-load suppression, teardown);
 * the fetch rides fetchPeriodRows (the shared dashboard read seam: retry,
 * row cap, error-vs-empty distinction). No period filter: the cluster is a
 * whole-history view, so a user-chosen range would not change what "the
 * same news" means — the query is one capped all-time read.
 *
 * WHY notices stays empty: the empty state is render-owned
 * (renderClusterPanel writes textContent/hidden per render), so there is no
 * separate notice scope to reset. A failed fetch leaves the panel blank and
 * lands in the lifecycle's structured log (the fetch seam retries before
 * it throws); a distinct error state is a later slice.
 */
export function createSimilarityClusterPanel(): PanelLifecycle {
  let listEl: HTMLElement | null = null;
  let emptyEl: HTMLElement | null = null;

  const lifecycle = createAsyncDataPanelLifecycle({
    label: 'similarityClusterPanel',
    notices: [],
    isReady: () => listEl !== null && emptyEl !== null,
    resetOutput: () => {
      if (listEl) {
        while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
        listEl.hidden = true;
      }
      if (emptyEl) emptyEl.hidden = true;
    },
    load: async ({ isStale }) => {
      if (!listEl || !emptyEl) return;
      const fetched = await fetchPeriodRows({ limit: MAX_QUERY_ROWS, label: 'similarityCluster' });
      if (isStale()) return;
      const records: SimilarityRecord[] = fetched.rows.map((row) => ({
        id: row.id,
        title: row.title ?? '',
        url: row.url,
        domain: row.domain ?? '',
        createdAt: row.created_at,
      }));
      renderClusterPanel({ list: listEl, emptyState: emptyEl }, localizeEmptyReason(buildClusterPanelModel(records)));
    },
  });

  return {
    id: 'panel-similarity-cluster',
    category: 'async-data',
    mount(container) {
      listEl = container.querySelector('#similarityClusterList');
      emptyEl = container.querySelector('#similarityClusterEmptyState');
      lifecycle.mount(container);
    },
    async load() {
      await lifecycle.reload();
    },
    destroy() {
      lifecycle.destroy();
      listEl = null;
      emptyEl = null;
    },
  };
}
