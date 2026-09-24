/**
 * tagClusterTimeSliderPanel.ts (PanelLifecycle)
 * Side-by-side tag-cluster comparison over the two halves of a user-specified
 * window (PBI 2026-09-24-08). Two native date inputs define the window; the
 * Compare button splits it at the midpoint and runs the tag-cluster pipeline
 * once per half ({since, until, limit: 10000} each), renders both snapshots
 * as two SVGs with independent pan/zoom controllers, and lists the tag diff
 * (appeared / disappeared / increased / decreased) below the graphs.
 *
 * WHY explicit Apply (not live recompute): each apply fires TWO capped
 * queries plus a client-side pipeline per half; the PBI fixes the interaction
 * as 2-time-point selection + apply, and a loadSeq generation guard makes
 * rapid input changes safe.
 *
 * WHY no animation: transition animations between snapshots are explicitly
 * out of scope (user-confirmed design: side-by-side + diff list); the panel
 * stays static, so prefers-reduced-motion needs no handling here.
 */

import { limitToTopNodes, type TagNode, type TagEdge } from '../../tagCooccurrence.js';
import {
  computeTagCooccurrenceHybrid,
  narrowEntriesToTopTagsHybrid,
} from '../../tagCooccurrenceHybrid.js';
import { MAX_TAG_CLUSTER_TAGS } from '../../../utils/computeLimits.js';
import { computeLayout, computeCanvasSize } from '../../tagClusterLayout.js';
import { TagClusterLoadingManager } from '../../tagClusterLoading.js';
import { TagClusterPanZoomController } from '../../tagClusterPanZoom.js';
import { fetchPeriodRows } from '../fetchPeriodRows.js';
import { getMessage, getMessageOr } from '../../../utils/i18n.js';
import {
  DAY_MS,
  endOfLocalDay,
  parseDateInput,
  startOfLocalDay,
} from '../../components/periodFilter.js';
import { splitPeriodInHalves } from '../../periodSplit.js';
import { computeTagDiff, type TagDiffResult } from '../../tagClusterDiff.js';
import { tagHue } from '../../tagClusterColor.js';
import { type PanelLifecycle } from '../types.js';
import { tryNavigateTyped } from '../registryContext.js';

const MAX_NODES = 50;
const MAX_QUERY_ROWS = 10000;
const SVG_NS = 'http://www.w3.org/2000/svg';
const DEFAULT_WINDOW_DAYS = 30;

interface HalfBounds {
  since: number;
  until: number;
}

interface SideRefs {
  svg: SVGSVGElement | null;
  emptyState: HTMLElement | null;
  truncatedNotice: HTMLElement | null;
  rowCapNotice: HTMLElement | null;
  zoomInBtn: HTMLElement | null;
  zoomOutBtn: HTMLElement | null;
  zoomResetBtn: HTMLElement | null;
  panZoom: TagClusterPanZoomController | null;
}

interface SideData {
  nodes: TagNode[];
  edges: TagEdge[];
  ok: boolean;
  empty: boolean;
}

/** getMessage with {name} substitutions and an English fallback template. */
function msg(key: string, subs: Record<string, string | number>, fallback: string): string {
  const translated = getMessage(key, subs);
  if (translated) return translated;
  return fallback.replace(/\{(\w+)\}/g, (_, name: string) =>
    subs[name] !== undefined ? String(subs[name]) : `{${name}}`,
  );
}

function navigateToHistoryWithTag(tag: string): void {
  const fallback = (): void => {
    document.dispatchEvent(new CustomEvent('navigate-to-tag', { detail: tag }));
  };
  tryNavigateTyped('panel-sqlite-history', { searchTag: tag }, fallback);
}

/** Local-date YYYY-MM-DD for a date input's value attribute. */
function toDateInputValue(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function clearChildren(element: HTMLElement): void {
  while (element.firstChild) element.removeChild(element.firstChild);
}

export function createTagClusterTimeSliderPanel(): PanelLifecycle {
  let startInput: HTMLInputElement | null = null;
  let endInput: HTMLInputElement | null = null;
  let runButton: HTMLButtonElement | null = null;
  let validationNotice: HTMLElement | null = null;
  let correctedNotice: HTMLElement | null = null;
  let statusLive: HTMLElement | null = null;
  let diffListHost: HTMLElement | null = null;
  let first: SideRefs = createEmptySideRefs();
  let second: SideRefs = createEmptySideRefs();
  let loadSeq = 0;

  function createEmptySideRefs(): SideRefs {
    return {
      svg: null,
      emptyState: null,
      truncatedNotice: null,
      rowCapNotice: null,
      zoomInBtn: null,
      zoomOutBtn: null,
      zoomResetBtn: null,
      panZoom: null,
    };
  }

  function hideSideNotices(side: SideRefs): void {
    if (side.emptyState) side.emptyState.hidden = true;
    if (side.truncatedNotice) side.truncatedNotice.hidden = true;
    if (side.rowCapNotice) side.rowCapNotice.hidden = true;
  }

  function clearSideSvg(side: SideRefs): void {
    side.panZoom?.cleanup();
    side.panZoom = null;
    if (!side.svg) return;
    while (side.svg.firstChild) side.svg.removeChild(side.svg.firstChild);
    side.svg.removeAttribute('viewBox');
  }

  function setSideMessage(side: SideRefs, key: string, fallback: string): void {
    if (!side.emptyState) return;
    // WHY: keep the data-i18n binding in sync so a later language switch
    // re-applies the same message (wordClusterPanel convention).
    side.emptyState.setAttribute('data-i18n', key);
    side.emptyState.textContent = getMessageOr(key, fallback);
  }

  /**
   * Fetch + narrow + cooccurrence + node-cap for one half. Renders nothing:
   * drawing waits until both halves are loaded so the stable-placement rule
   * (below) can order both sides from the shared union tag list.
   */
  async function fetchSide(
    side: SideRefs,
    bounds: HalfBounds,
    seq: number,
    label: string,
    loadingManager: TagClusterLoadingManager
  ): Promise<SideData | null> {
    if (!side.svg) return null;
    loadingManager.show();
    try {
      // WHY: both halves always carry explicit bounds (HalfBounds), so no
      // key-omission decision happens here — fetchPeriodRows owns it anyway.
      const fetched = await fetchPeriodRows({
        since: bounds.since,
        until: bounds.until,
        limit: MAX_QUERY_ROWS,
        label,
      });
      if (seq !== loadSeq) {
        loadingManager.cleanup();
        return null;
      }
      loadingManager.updateStep(0);

      // WHY: queryLogs caps the fetch at MAX_QUERY_ROWS; when the half holds
      // more rows the analyzed set is a prefix — the PBI requires the
      // truncation to be visible per half.
      if (fetched.capped && side.rowCapNotice) {
        side.rowCapNotice.textContent = msg(
          'tagClusterCompareCapNotice',
          { max: MAX_QUERY_ROWS, shown: fetched.rows.length, total: fetched.total },
          `The query hit the ${MAX_QUERY_ROWS}-row limit — aggregating the most recent ${fetched.rows.length} of ${fetched.total} records in this half.`,
        );
        side.rowCapNotice.hidden = false;
      }

      // Narrow to the most frequent tags BEFORE cooccurrence — same O(n^2)
      // bound as the tag-cluster panel (VULN-053).
      const narrowedRows = await narrowEntriesToTopTagsHybrid(fetched.rows, MAX_TAG_CLUSTER_TAGS);
      const { nodes, edges } = await computeTagCooccurrenceHybrid(narrowedRows);
      if (seq !== loadSeq) {
        loadingManager.cleanup();
        return null;
      }
      loadingManager.updateStep(1);

      if (nodes.length === 0) {
        loadingManager.cleanup();
        setSideMessage(side, 'tagClusterCompareEmptyPeriod', 'No records in this half of the window.');
        if (side.emptyState) side.emptyState.hidden = false;
        return { nodes: [], edges: [], ok: true, empty: true };
      }

      const limited = limitToTopNodes(nodes, edges, MAX_NODES);
      if (side.truncatedNotice) side.truncatedNotice.hidden = !limited.truncated;
      return { nodes: limited.nodes, edges: limited.edges, ok: true, empty: false };
    } catch (error) {
      loadingManager.cleanup();
      console.error(`[${label}] error:`, error);
      if (seq !== loadSeq) return null;
      setSideMessage(side, 'tagClusterTimeSliderError', 'Failed to load this half of the comparison. Try again.');
      if (side.emptyState) side.emptyState.hidden = false;
      return { nodes: [], edges: [], ok: false, empty: true };
    }
  }

  /**
   * WHY union-ordered nodes: computeLayout seeds its circular initial
   * positions from the input node order, so feeding both sides the same
   * union-sorted ordering (plus the same union-sized canvas) gives common
   * tags the same initial placement rule and — whenever both snapshots hold
   * the same node set — identical initial positions. Per-side force
   * iterations still adapt each snapshot to its own edges afterwards.
   */
  function unionTagOrder(firstNodes: TagNode[], secondNodes: TagNode[]): Map<string, number> {
    const tags = new Set<string>();
    for (const node of firstNodes) tags.add(node.tag);
    for (const node of secondNodes) tags.add(node.tag);
    const sorted = Array.from(tags).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return new Map(sorted.map((tag, index) => [tag, index]));
  }

  function renderSide(side: SideRefs, halfLabelKey: string, halfLabelFallback: string, data: SideData, unionOrder: Map<string, number>, unionCount: number, loadingManager: TagClusterLoadingManager): void {
    if (!side.svg) return;
    if (data.empty) return;

    const orderedNodes = [...data.nodes].sort(
      (a, b) => (unionOrder.get(a.tag) ?? 0) - (unionOrder.get(b.tag) ?? 0)
    );
    // WHY: both sides size their canvas from the union node count so the
    // circular seeds share the same geometry, not just the same order.
    const canvasSize = computeCanvasSize(unionCount);
    const positions = computeLayout(orderedNodes, data.edges, canvasSize.width, canvasSize.height);
    loadingManager.updateStep(2);

    for (const edge of data.edges) {
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
      side.svg.appendChild(line);
    }

    for (const node of orderedNodes) {
      const pos = positions.get(node.tag);
      if (!pos) continue;
      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', String(pos.x));
      circle.setAttribute('cy', String(pos.y));
      circle.setAttribute('r', String(4 + Math.min(node.count, 20)));
      circle.setAttribute('class', 'tag-cluster-node tag-cluster-compare-node');
      // WHY: the hue travels as a CSS custom property so dashboard.css can
      // resolve the scheme-appropriate fixed saturation/lightness per node.
      circle.style.setProperty('--tag-hue', String(tagHue(node.tag)));
      circle.addEventListener('click', () => {
        if (side.panZoom?.wasDragSuppressingClick()) return;
        navigateToHistoryWithTag(node.tag);
      });

      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = `#${node.tag} (${node.count})`;
      circle.appendChild(title);

      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', String(pos.x));
      text.setAttribute('y', String(pos.y));
      text.setAttribute('dy', '0.3em');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('class', 'tag-cluster-text');
      text.setAttribute('pointer-events', 'none');
      text.textContent = `#${node.tag}`;

      side.svg.appendChild(circle);
      side.svg.appendChild(text);
    }

    // Text alternative for the graph (wordClusterPanel precedent).
    side.svg.setAttribute('role', 'img');
    side.svg.setAttribute(
      'aria-label',
      `${getMessageOr(halfLabelKey, halfLabelFallback)}: ${orderedNodes
        .slice(0, 10)
        .map((node) => `#${node.tag}`)
        .join(', ')}`,
    );

    loadingManager.updateStep(3);
    loadingManager.cleanup();

    side.panZoom = new TagClusterPanZoomController(side.svg, canvasSize, {
      zoomInBtn: side.zoomInBtn,
      zoomOutBtn: side.zoomOutBtn,
      resetBtn: side.zoomResetBtn,
    });
    side.panZoom.attach();
  }

  function appendDiffSection(host: HTMLElement, headingKey: string, headingFallback: string, items: Array<{ tag: string; delta: number | null }>): void {
    const heading = document.createElement('h3');
    heading.setAttribute('class', 'tag-cluster-diff-heading');
    heading.setAttribute('data-i18n', headingKey);
    heading.textContent = getMessageOr(headingKey, headingFallback);
    host.appendChild(heading);

    const list = document.createElement('ul');
    list.setAttribute('class', 'tag-cluster-diff-list');
    for (const item of items) {
      const li = document.createElement('li');

      const swatch = document.createElement('span');
      swatch.setAttribute('class', 'tag-cluster-diff-swatch');
      swatch.setAttribute('aria-hidden', 'true');
      swatch.style.setProperty('--tag-hue', String(tagHue(item.tag)));
      li.appendChild(swatch);

      // WHY: a real button (not an onclick span) keeps diff entries keyboard
      // operable, mirroring the SVG node click-through.
      const tagButton = document.createElement('button');
      tagButton.setAttribute('type', 'button');
      tagButton.setAttribute('class', 'tag-cluster-diff-tag');
      tagButton.textContent = `#${item.tag}`;
      tagButton.addEventListener('click', () => {
        navigateToHistoryWithTag(item.tag);
      });
      li.appendChild(tagButton);

      if (item.delta !== null) {
        const deltaSpan = document.createElement('span');
        deltaSpan.setAttribute('class', 'tag-cluster-diff-delta');
        deltaSpan.textContent = item.delta > 0 ? `+${item.delta}` : String(item.delta);
        li.appendChild(deltaSpan);
      }

      list.appendChild(li);
    }
    host.appendChild(list);
  }

  function renderDiffList(diff: TagDiffResult): void {
    if (!diffListHost) return;
    clearChildren(diffListHost);
    appendDiffSection(diffListHost, 'tagClusterDiffAppeared', 'Appeared tags', diff.appeared.map((tag) => ({ tag, delta: null })));
    appendDiffSection(diffListHost, 'tagClusterDiffDisappeared', 'Disappeared tags', diff.disappeared.map((tag) => ({ tag, delta: null })));
    appendDiffSection(diffListHost, 'tagClusterDiffIncreased', 'Increased tags', diff.increased.map((entry) => ({ tag: entry.tag, delta: entry.delta })));
    appendDiffSection(diffListHost, 'tagClusterDiffDecreased', 'Decreased tags', diff.decreased.map((entry) => ({ tag: entry.tag, delta: entry.delta })));
  }

  function setStatus(key: string, fallback: string, subs?: Record<string, string | number>): void {
    if (!statusLive) return;
    statusLive.textContent = subs ? msg(key, subs, fallback) : getMessageOr(key, fallback);
  }

  function showValidation(fallback: string): void {
    if (!validationNotice) return;
    validationNotice.textContent = getMessageOr('tagClusterCompareInvalidRange', fallback);
    validationNotice.hidden = false;
  }

  async function apply(): Promise<void> {
    if (!startInput || !endInput) return;
    if (validationNotice) validationNotice.hidden = true;
    if (correctedNotice) correctedNotice.hidden = true;
    hideSideNotices(first);
    hideSideNotices(second);
    if (diffListHost) clearChildren(diffListHost);

    const startValue = startInput.value;
    const endValue = endInput.value;
    const startTs = parseDateInput(startValue);
    const endDayTs = parseDateInput(endValue);
    if (!Number.isFinite(startTs) || !Number.isFinite(endDayTs)) {
      showValidation('Select both a start and an end date to compare.');
      return;
    }

    let since = startTs;
    let until = endOfLocalDay(endDayTs);
    // WHY: swap the input values too, so the correction is visible and the
    // next apply is already in the corrected order (PBI: 補正される).
    if (since > until) {
      // WHY: `since` is midnight of the later day and `until` end-of-day of
      // the earlier one — each timestamp already carries its own day, so the
      // swap needs no extra day math.
      const earlierDay = until;
      const laterDay = since;
      startInput.value = toDateInputValue(earlierDay);
      endInput.value = toDateInputValue(laterDay);
      since = startOfLocalDay(earlierDay);
      until = endOfLocalDay(laterDay);
      if (correctedNotice) {
        correctedNotice.textContent = getMessageOr(
          'tagClusterCompareInvalidRangeCorrected',
          'The start was after the end — the order was corrected automatically.',
        );
        correctedNotice.hidden = false;
      }
    }
    // WHY: the end input resolves to end-of-day, so since === until cannot
    // occur for valid date inputs; this guard is defense in depth for
    // zero-length windows (PBI empty-window criterion).
    if (until - since <= 0) {
      showValidation('The selected window is empty — choose two different dates.');
      return;
    }

    const halves = splitPeriodInHalves(since, until);
    if (!halves) {
      showValidation('Select both a start and an end date to compare.');
      return;
    }

    const seq = ++loadSeq;
    setStatus('tagClusterTimeSliderLoading', 'Comparing tag clusters…');
    clearSideSvg(first);
    clearSideSvg(second);
    hideSideNotices(first);
    hideSideNotices(second);

    if (!first.svg || !second.svg) return;
    const firstLoading = new TagClusterLoadingManager(first.svg);
    const secondLoading = new TagClusterLoadingManager(second.svg);

    // WHY: the two halves are independent queries — run them in parallel
    // (Promise.all) instead of serially, or every Compare click waits twice
    // the wall-clock for capped queries plus two co-occurrence pipelines.
    const [firstData, secondData] = await Promise.all([
      fetchSide(first, halves.first, seq, 'tagClusterTimeSliderFirst', firstLoading),
      fetchSide(second, halves.second, seq, 'tagClusterTimeSliderSecond', secondLoading),
    ]);
    if (seq !== loadSeq) return;

    const bothOk = firstData !== null && firstData.ok && secondData !== null && secondData.ok;
    if (bothOk && firstData && secondData) {
      const unionOrder = unionTagOrder(firstData.nodes, secondData.nodes);
      const unionCount = unionOrder.size;
      renderSide(first, 'tagClusterCompareFirstHalf', 'First half', firstData, unionOrder, unionCount, firstLoading);
      renderSide(second, 'tagClusterCompareSecondHalf', 'Second half', secondData, unionOrder, unionCount, secondLoading);

      const diff = computeTagDiff(firstData.nodes, secondData.nodes);
      renderDiffList(diff);
      setStatus(
        'tagClusterTimeSliderStatusDone',
        'Comparison complete: first half {first} tags, second half {second} tags, {appeared} appeared, {disappeared} disappeared.',
        {
          first: firstData.nodes.length,
          second: secondData.nodes.length,
          appeared: diff.appeared.length,
          disappeared: diff.disappeared.length,
        },
      );
    } else {
      // WHY: a failed half would fabricate appeared/disappeared entries for
      // every tag of the healthy side — the diff stays empty until both
      // halves load successfully.
      setStatus('tagClusterTimeSliderError', 'Failed to load this half of the comparison. Try again.');
      // WHY: fetchSide defers overlay cleanup to renderSide, which only runs
      // when BOTH halves succeed — clean up the surviving side's frozen
      // overlay here so a failure does not leave it on screen.
      firstLoading.cleanup();
      secondLoading.cleanup();
    }
  }

  return {
    id: 'panel-tag-cluster-time-slider',
    category: 'async-data',
    mount(container) {
      // WHY: `querySelector` returns `Element | null`; cast needed for SVG-specific API access
      startInput = container.querySelector('#tagCompareStartDate') as HTMLInputElement | null;
      endInput = container.querySelector('#tagCompareEndDate') as HTMLInputElement | null;
      runButton = container.querySelector('#tagCompareRunBtn') as HTMLButtonElement | null;
      validationNotice = container.querySelector('#tagCompareValidation');
      correctedNotice = container.querySelector('#tagCompareCorrectedNotice');
      statusLive = container.querySelector('#tagCompareStatus');
      diffListHost = container.querySelector('#tagCompareDiffList');

      first = {
        ...createEmptySideRefs(),
        svg: container.querySelector('#tagCompareFirstSvg') as unknown as SVGSVGElement | null,
        emptyState: container.querySelector('#tagCompareFirstEmpty'),
        truncatedNotice: container.querySelector('#tagCompareFirstTruncated'),
        rowCapNotice: container.querySelector('#tagCompareFirstCapNotice'),
        zoomInBtn: container.querySelector('#tagCompareFirstZoomIn'),
        zoomOutBtn: container.querySelector('#tagCompareFirstZoomOut'),
        zoomResetBtn: container.querySelector('#tagCompareFirstZoomReset'),
      };
      second = {
        ...createEmptySideRefs(),
        svg: container.querySelector('#tagCompareSecondSvg') as unknown as SVGSVGElement | null,
        emptyState: container.querySelector('#tagCompareSecondEmpty'),
        truncatedNotice: container.querySelector('#tagCompareSecondTruncated'),
        rowCapNotice: container.querySelector('#tagCompareSecondCapNotice'),
        zoomInBtn: container.querySelector('#tagCompareSecondZoomIn'),
        zoomOutBtn: container.querySelector('#tagCompareSecondZoomOut'),
        zoomResetBtn: container.querySelector('#tagCompareSecondZoomReset'),
      };

      // Sensible default window so the first Compare works without typing:
      // [today - 30 days, today].
      if (startInput && !startInput.value) {
        startInput.value = toDateInputValue(Date.now() - DEFAULT_WINDOW_DAYS * DAY_MS);
      }
      if (endInput && !endInput.value) {
        endInput.value = toDateInputValue(Date.now());
      }

      runButton?.addEventListener('click', () => {
        void apply();
      });
    },
    async load() {
      await apply();
    },
    destroy() {
      loadSeq += 1;
      first.panZoom?.cleanup();
      second.panZoom?.cleanup();
      first = createEmptySideRefs();
      second = createEmptySideRefs();
      startInput = null;
      endInput = null;
      runButton = null;
      validationNotice = null;
      correctedNotice = null;
      statusLive = null;
      diffListHost = null;
    },
  };
}
