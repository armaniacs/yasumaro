/**
 * clusterGraphRenderer.ts
 * The one SVG cooccurrence-graph renderer behind the tag-cluster, word-cluster
 * and tag-cluster-compare panels (PBI 2026-09-28-17).
 *
 * WHY: the three panels each carried a verbatim copy of the same draw skeleton
 * (node cap → canvas size → layout → edges → nodes → role/aria-label →
 * pan/zoom attach) and each re-declared MAX_NODES and SVG_NS, so a change to
 * the graph markup had to be made in three places and a cap could drift per
 * panel without anyone noticing.
 *
 * The per-panel differences are options here, not copies: only the compare
 * panel colors a node by its stable tag hue and carries the compare node
 * class, and only the word-cluster panel drops the leading '#' from labels.
 * Those are current UI contracts, so the panels keep choosing them.
 */

import { limitToTopNodes, type TagEdge, type TagNode } from '../../tagCooccurrence.js';
import { computeCanvasSize, computeLayout } from '../../tagClusterLayout.js';
import { TagClusterPanZoomController, type PanZoomButtons } from '../../tagClusterPanZoom.js';
import { tagHue } from '../../tagClusterColor.js';
import { makeGraphNodeAccessible } from '../../graphNodeA11y.js';
import { navigateToHistoryWithTag } from '../navigateToHistory.js';
import { getMessageWithSubstitutions } from '../../../utils/i18n.js';
import type { PanelNotices } from '../PanelNotices.js';

/** Single source of the SVG namespace for every cluster-graph draw site. */
export const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Node cap every cluster graph renders under. Single-sourced so raising it
 * moves all three panels at once (the intended propagation) and the panels
 * cannot disagree about what "capped" means.
 */
export const MAX_NODES = 50;

const DEFAULT_NODE_CLASS = 'tag-cluster-node';
const DEFAULT_LABEL_PREFIX = '#';
const MAX_EDGE_STROKE = 5;
const NODE_RADIUS_BASE = 4;
const NODE_RADIUS_CAP = 20;

export interface LimitedCluster {
  nodes: TagNode[];
  edges: TagEdge[];
  truncated: boolean;
}

/**
 * Caps a cluster at MAX_NODES and publishes the outcome through the panel's
 * registered `truncated` notice — one show/hide pair for all three panels.
 *
 * WHY the cap is not folded into renderClusterGraph: the compare panel caps
 * during its fetch, because the diff under the graphs must be classified from
 * the same capped node set that is drawn. The panels pass the result in.
 */
export function limitClusterNodes(
  nodes: TagNode[],
  edges: TagEdge[],
  notices: PanelNotices,
): LimitedCluster {
  const limited = limitToTopNodes(nodes, edges, MAX_NODES);
  if (limited.truncated) {
    notices.show('truncated');
  } else {
    notices.hide('truncated');
  }
  return limited;
}

export interface ClusterGraphRenderOptions {
  svg: SVGSVGElement;
  /** Already capped, in render order (the compare panel passes its union order). */
  nodes: TagNode[];
  edges: TagEdge[];
  /**
   * The SVG's text alternative, assembled by the caller: the panels label
   * their graphs differently (panel title, keyword count, half label) and
   * that wording is a UI contract, not a detail to normalize here.
   */
  ariaLabel: (nodes: TagNode[]) => string;
  buttons?: PanZoomButtons;
  /** Node class; the compare panel appends its own class to the default. */
  nodeClassName?: string;
  /** Prefix in front of the tag in the node label, title and node text. */
  labelPrefix?: string;
  /**
   * Set `--tag-hue` per node from the tag's stable hue so dashboard.css can
   * resolve the scheme-appropriate saturation/lightness. Compare panel only.
   */
  hueByTag?: boolean;
  /**
   * Node count the canvas is sized from. Defaults to the drawn node count;
   * the compare panel passes the union count so both halves share one
   * geometry (its stable-placement rule), not just one seed order.
   */
  canvasNodeCount?: number;
}

/**
 * Draws the capped cluster into `svg` and attaches pan/zoom. Returns the
 * attached controller so the panel can hand it to the shared lifecycle
 * ring's teardown, which owns cleanup.
 */
export function renderClusterGraph(
  options: ClusterGraphRenderOptions,
): TagClusterPanZoomController {
  const { svg, nodes, edges, ariaLabel } = options;
  const nodeClassName = options.nodeClassName ?? DEFAULT_NODE_CLASS;
  const labelPrefix = options.labelPrefix ?? DEFAULT_LABEL_PREFIX;
  const canvasSize = computeCanvasSize(options.canvasNodeCount ?? nodes.length);
  const positions = computeLayout(nodes, edges, canvasSize.width, canvasSize.height);

  // WHY: the node click handlers must see the controller created at the end of
  // this call, so a drag that ends over a node still suppresses the
  // click-through instead of navigating.
  let panZoom: TagClusterPanZoomController | null = null;

  for (const edge of edges) {
    const a = positions.get(edge.source);
    const b = positions.get(edge.target);
    if (!a || !b) continue;
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', String(a.x));
    line.setAttribute('y1', String(a.y));
    line.setAttribute('x2', String(b.x));
    line.setAttribute('y2', String(b.y));
    line.setAttribute('class', 'tag-cluster-edge');
    line.setAttribute('stroke-width', String(Math.min(edge.weight, MAX_EDGE_STROKE)));
    svg.appendChild(line);
  }

  for (const node of nodes) {
    const pos = positions.get(node.tag);
    if (!pos) continue;
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', String(pos.x));
    circle.setAttribute('cy', String(pos.y));
    circle.setAttribute('r', String(NODE_RADIUS_BASE + Math.min(node.count, NODE_RADIUS_CAP)));
    circle.setAttribute('class', nodeClassName);
    if (options.hueByTag) {
      // WHY: the hue travels as a CSS custom property so dashboard.css can
      // resolve the scheme-appropriate fixed saturation/lightness per node.
      circle.style.setProperty('--tag-hue', String(tagHue(node.tag)));
    }
    // WHY: click-through stays tag-only — carrying the period into the
    // history panel is explicitly out of scope for v1 (PBI 2026-09-24-04).
    // Keyword nodes reuse the same search navigation; keywords are not
    // stored tags, so the history search may be empty, accepted for v1.
    // Keyboard/AT access (WCAG 2.1.1/1.1.1) via the shared helper.
    const activate = (): void => {
      navigateToHistoryWithTag(node.tag);
    };
    makeGraphNodeAccessible(circle, `${labelPrefix}${node.tag} (${node.count})`, activate);
    circle.addEventListener('click', () => {
      if (panZoom?.wasDragSuppressingClick()) return;
      activate();
    });

    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = `${labelPrefix}${node.tag} (${node.count})`;
    circle.appendChild(title);

    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', String(pos.x));
    text.setAttribute('y', String(pos.y));
    text.setAttribute('dy', '0.3em');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('class', 'tag-cluster-text');
    text.setAttribute('pointer-events', 'none');
    text.textContent = `${labelPrefix}${node.tag}`;

    svg.appendChild(circle);
    svg.appendChild(text);
  }

  // Text alternative for the graph (wordClusterPanel precedent).
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', ariaLabel(nodes));

  panZoom = new TagClusterPanZoomController(svg, canvasSize, options.buttons);
  panZoom.attach();
  return panZoom;
}

export interface RowCapNoticeOptions {
  /** Notice scope owning the panel's registered `rowCap` element. */
  notices: PanelNotices;
  messageKey: string;
  /** Panel-specific tail wording, used when the key has no translation. */
  fallback: string;
  /** Rows this fetch actually returned. */
  shown: number;
  /** Rows the period holds in total. */
  total: number;
  /** The fetch limit that was hit. */
  limit: number;
}

/**
 * Publishes the fetch-cap notice for a cluster panel.
 *
 * WHY shared: queryLogs caps every fetch, so a period holding more rows than
 * the cap analyzes a prefix, and both capped cluster panels had to say so
 * with the same substitutions. Only the key and the fallback tail differ
 * (the compare panel adds "in this half"), so those stay with the panel.
 */
export function showRowCapNotice(options: RowCapNoticeOptions): void {
  options.notices.setMessage(
    'rowCap',
    getMessageWithSubstitutions(
      options.messageKey,
      { max: options.limit, shown: options.shown, total: options.total },
      options.fallback,
    ),
  );
  options.notices.show('rowCap');
}
