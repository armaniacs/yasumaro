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
import { CLUSTER_RECORDS_CAP } from '../utils/computeLimits.js';
import { getMessageOr } from '../utils/i18n.js';
import { fetchPeriodRows } from './panels/fetchPeriodRows.js';
import { createAsyncDataPanelLifecycle } from './panels/asyncData/asyncDataPanelLifecycle.js';
import { type PanelLifecycle } from './panels/types.js';
import { logError } from '../utils/logger/api.js';
import { ErrorCode } from '../utils/logger/types.js';
import { errorMessage } from '../utils/errorUtils.js';

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
  /**
   * Which fetch truncation to report over the rendered clusters: the
   * compared record count vs the period total, null when the read came back
   * complete. The numbers ride the model (i18n-free); the factory owns the
   * locale text and the render owns the element.
   */
  capNotice: { shown: number; total: number } | null;
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
        : 'No titled records to compare yet. Clusters appear here once recorded pages carry titles.',
      emptyReasonKey: hasTitle ? 'noSimilarGroups' : 'noTitles',
      capNotice: null,
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
    // The pure builder never sees the fetch: the factory composes the
    // truncation report onto the built model.
    capNotice: null,
  };
}

export interface ClusterPanelRenderHosts {
  list: HTMLElement;
  emptyState: HTMLElement;
}

/** Display strings. Injectable so tests pin behavior without i18n. */
export interface ClusterPanelLabels {
  /**
   * Heading template with `{count}` / `{domains}` / `{date}` placeholders
   * (the formatPlaybackHeading pattern: the fixed-English heading is i18n
   * keyed and the substitution is the pure helper below, so jsdom tests pin
   * it without i18n).
   */
  clusterHeading: string;
  /** Row-cap notice template with `{shown}` / `{total}` / `{max}` placeholders. */
  rowCapNotice: string;
}

const DEFAULT_LABELS: ClusterPanelLabels = {
  clusterHeading: '{count} articles - {domains} - {date}',
  rowCapNotice: 'The comparison covers the newest {shown} of {total} records ({max}-record limit).',
};

/**
 * Pure placeholder substitution for the cluster heading (no i18n / DOM
 * dependency): every `{name}` in the template is replaced; unknown
 * placeholders stay verbatim so a locale's typo cannot crash the render.
 */
export function formatClusterHeading(
  template: string,
  parts: { count: number; domains: string; date: string },
): string {
  return template
    .replace(/\{count\}/g, String(parts.count))
    .replace(/\{domains\}/g, parts.domains)
    .replace(/\{date\}/g, parts.date);
}

/** Pure placeholder substitution for the row-cap notice (same contract). */
export function formatClusterCapNotice(
  template: string,
  parts: { shown: number; total: number; max: number },
): string {
  return template
    .replace(/\{shown\}/g, String(parts.shown))
    .replace(/\{total\}/g, String(parts.total))
    .replace(/\{max\}/g, String(parts.max));
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
  labels: ClusterPanelLabels = DEFAULT_LABELS,
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
  // Fetch truncation (capped all-time read): a notice paragraph above the
  // clusters says which slice was compared (the rowCapNotice convention).
  if (model.capNotice !== null) {
    const notice = document.createElement('p');
    notice.className = 'data-table-notice is-warning';
    notice.textContent = formatClusterCapNotice(labels.rowCapNotice, {
      shown: model.capNotice.shown,
      total: model.capNotice.total,
      max: CLUSTER_RECORDS_CAP,
    });
    hosts.list.appendChild(notice);
  }
  for (const item of model.items) {
    const section = document.createElement('section');
    const heading = document.createElement('h3');
    heading.textContent = formatClusterHeading(labels.clusterHeading, {
      count: item.memberCount,
      domains: item.domains.join(', '),
      date: new Date(item.freshestAt).toLocaleDateString(getUserLocale()),
    });
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

/** Labels from i18n with the pure module's English defaults as fallbacks. */
function clusterLabels(): ClusterPanelLabels {
  return {
    clusterHeading: getMessageOr('similarityClusterHeading', DEFAULT_LABELS.clusterHeading),
    rowCapNotice: getMessageOr('similarityClusterRowCapNotice', DEFAULT_LABELS.rowCapNotice),
  };
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
 * Boundary control (PBI 2026-10-22-03 third-party review): the read is capped
 * at CLUSTER_RECORDS_CAP so the greedy pair comparison stays O(cap^2) and an
 * attacker-influenced title corpus cannot freeze the dashboard origin for
 * minutes. A truncated read is reported with the row-cap notice, not hidden.
 *
 * WHY notices stays empty: the empty and error states are render-owned
 * (renderClusterPanel writes textContent/hidden per render, the load's catch
 * swaps the error wording into the same element — the PanelNotices `empty`
 * convention), so there is no separate notice scope to reset; the row-cap
 * notice is a render-owned paragraph of the list for the same reason.
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
      try {
        const fetched = await fetchPeriodRows({ limit: CLUSTER_RECORDS_CAP, label: 'similarityCluster' });
        if (isStale()) return;
        const records: SimilarityRecord[] = fetched.rows.map((row) => ({
          id: row.id,
          title: row.title ?? '',
          url: row.url,
          domain: row.domain ?? '',
          createdAt: row.created_at,
        }));
        const model = buildClusterPanelModel(records);
        const capNotice = fetched.capped ? { shown: records.length, total: fetched.total } : null;
        renderClusterPanel(
          { list: listEl, emptyState: emptyEl },
          localizeEmptyReason({ ...model, capNotice }),
          clusterLabels(),
        );
      } catch (error) {
        // 構造化ログ移行 (ログ指摘 2026-10-15): the structured log keeps the
        // persistent failure visible (the fetch seam retries before it throws).
        void logError('[similarityClusterPanel] load failed', { error: errorMessage(error) }, ErrorCode.STORAGE_READ_FAILURE, 'similarityClusterPanel');
        if (isStale()) return;
        // A persistent fetch failure must not leave the panel blank: the
        // empty element doubles as the error surface (the PanelNotices
        // `empty` convention) and resetOutput hides it again on the next
        // fresh fetch.
        emptyEl.textContent = getMessageOr('similarityClusterError', 'Failed to load similar stories. Try again.');
        emptyEl.setAttribute('data-i18n', 'similarityClusterError');
        emptyEl.hidden = false;
        listEl.hidden = true;
      }
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
