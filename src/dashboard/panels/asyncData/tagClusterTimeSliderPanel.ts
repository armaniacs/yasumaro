/**
 * tagClusterTimeSliderPanel.ts (PanelLifecycle)
 * Side-by-side tag-cluster comparison over the two halves of a user-specified
 * window (PBI 2026-09-24-08). Two native date inputs define the window through
 * the shared local-date contract (periodFilter's customRangeToBounds /
 * parseDateInput); the Compare button splits the resolved window at the
 * midpoint and runs the tag-cluster pipeline once per half
 * ({since, until, limit: 10000} each), renders both snapshots as two SVGs with
 * independent pan/zoom controllers, and lists the tag diff
 * (appeared / disappeared / increased / decreased) below the graphs.
 *
 * WHY explicit Apply (not live recompute): each apply fires TWO capped
 * queries plus a client-side pipeline per half; the PBI fixes the interaction
 * as 2-time-point selection + apply, and the shared reload ring's generation
 * guard (PBI 2026-09-28-09) makes rapid input changes safe.
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
import {
  MAX_QUERY_ROWS,
  MAX_TAG_CLUSTER_TAGS,
} from '../../../utils/computeLimits.js';
import { computeLayout, computeCanvasSize } from '../../tagClusterLayout.js';
import { TagClusterLoadingManager } from '../../tagClusterLoading.js';
import { TagClusterPanZoomController } from '../../tagClusterPanZoom.js';
import { fetchPeriodRows } from '../fetchPeriodRows.js';
import { PanelNotices } from '../PanelNotices.js';
import { getMessageOr, getMessageWithSubstitutions as msg } from '../../../utils/i18n.js';
import {
  DAY_MS,
  customRangeToBounds,
  parseDateInput,
} from '../../components/periodFilter.js';
import { splitPeriodInHalves, type PeriodHalves } from '../../periodSplit.js';
import { formatLocalDateString } from '../../../utils/localDate.js';
import { computeTagDiff, type TagDiffResult } from '../../tagClusterDiff.js';
import { tagHue } from '../../tagClusterColor.js';
import { createAsyncDataPanelLifecycle } from './asyncDataPanelLifecycle.js';
import { type PanelLifecycle } from '../types.js';
import { navigateToHistoryWithTag } from '../navigateToHistory.js';
import { makeGraphNodeAccessible } from '../../graphNodeA11y.js';

const MAX_NODES = 50;
const SVG_NS = 'http://www.w3.org/2000/svg';
const DEFAULT_WINDOW_DAYS = 30;

interface HalfBounds {
  since: number;
  until: number;
}

interface SideRefs {
  svg: SVGSVGElement | null;
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

/** Local-date YYYY-MM-DD for a date input's value attribute. */
function toDateInputValue(ts: number): string {
  return formatLocalDateString(ts);
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
  // WHY: the halves the next load compares. Set by apply() once the window
  // parsed, read by the load body — a rejected window never reaches a load.
  let pendingHalves: PeriodHalves | null = null;
  // WHY: each half is its own notice scope — its empty-state element doubles
  // as the error surface (one element, two modes). The per-half row-cap
  // notice describes the FETCH, so it is fetch-scoped.
  const firstNotices = new PanelNotices();
  const secondNotices = new PanelNotices();

  function createEmptySideRefs(): SideRefs {
    return {
      svg: null,
      zoomInBtn: null,
      zoomOutBtn: null,
      zoomResetBtn: null,
      panZoom: null,
    };
  }

  function clearSideSvg(side: SideRefs): void {
    side.panZoom?.cleanup();
    side.panZoom = null;
    if (!side.svg) return;
    while (side.svg.firstChild) side.svg.removeChild(side.svg.firstChild);
    side.svg.removeAttribute('viewBox');
  }

  /**
   * Fetch + narrow + cooccurrence + node-cap for one half. Renders nothing:
   * drawing waits until both halves are loaded so the stable-placement rule
   * (below) can order both sides from the shared union tag list.
   */
  async function fetchSide(
    side: SideRefs,
    sideNotices: PanelNotices,
    bounds: HalfBounds,
    isStale: () => boolean,
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
      if (isStale()) {
        loadingManager.cleanup();
        return null;
      }
      loadingManager.updateStep(0);

      // WHY: queryLogs caps the fetch at MAX_QUERY_ROWS; when the half holds
      // more rows the analyzed set is a prefix — the PBI requires the
      // truncation to be visible per half.
      if (fetched.capped) {
        sideNotices.setMessage(
          'rowCap',
          msg(
            'tagClusterCompareCapNotice',
            { max: MAX_QUERY_ROWS, shown: fetched.rows.length, total: fetched.total },
            `The query hit the ${MAX_QUERY_ROWS}-row limit — aggregating the most recent ${fetched.rows.length} of ${fetched.total} records in this half.`,
          ),
        );
        sideNotices.show('rowCap');
      }

      // Narrow to the most frequent tags BEFORE cooccurrence — same O(n^2)
      // bound as the tag-cluster panel (VULN-053).
      const narrowedRows = await narrowEntriesToTopTagsHybrid(fetched.rows, MAX_TAG_CLUSTER_TAGS);
      const { nodes, edges } = await computeTagCooccurrenceHybrid(narrowedRows);
      if (isStale()) {
        loadingManager.cleanup();
        return null;
      }
      loadingManager.updateStep(1);

      if (nodes.length === 0) {
        loadingManager.cleanup();
        sideNotices.showEmpty('tagClusterCompareEmptyPeriod', 'No records in this half of the window.');
        return { nodes: [], edges: [], ok: true, empty: true };
      }

      const limited = limitToTopNodes(nodes, edges, MAX_NODES);
      if (limited.truncated) {
        sideNotices.show('truncated');
      } else {
        sideNotices.hide('truncated');
      }
      return { nodes: limited.nodes, edges: limited.edges, ok: true, empty: false };
    } catch (error) {
      loadingManager.cleanup();
      console.error(`[${label}] error:`, error);
      if (isStale()) return null;
      sideNotices.showError(
        'tagClusterTimeSliderError',
        'Failed to load this half of the comparison. Try again.',
      );
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
      const activate = (): void => {
        navigateToHistoryWithTag(node.tag);
      };
      makeGraphNodeAccessible(circle, `#${node.tag} (${node.count})`, activate);
      circle.addEventListener('click', () => {
        if (side.panZoom?.wasDragSuppressingClick()) return;
        activate();
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
    // Fresh-apply reset per half: restores the normal empty binding in case
    // a previous apply failed and swapped in the error message, and hides
    // the truncation/row-cap notices until the new halves decide visibility.
    // It runs before the input check so a rejected window still leaves no
    // stale comparison behind.
    lifecycle.resetNotices();
    if (diffListHost) clearChildren(diffListHost);

    const startValue = startInput.value;
    const endValue = endInput.value;
    const startTs = parseDateInput(startValue);
    const endTs = parseDateInput(endValue);
    // WHY: the gate stays panel-owned — customRangeToBounds reads an empty
    // start as "unbounded", while an unusable input here is a validation
    // message, not an all-time window.
    if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) {
      showValidation('Select both a start and an end date to compare.');
      return;
    }

    const now = Date.now();
    // WHY: customRangeToBounds is the shared local-date contract (local
    // midnight start, end-of-day end, whole local days) — the panel must not
    // re-derive day boundaries of its own. Both inputs passed the gate, so
    // both bounds are present; the `??` defaults only satisfy PeriodRange's
    // optional fields.
    let bounds = customRangeToBounds(startValue, endValue, now);
    let since = bounds.since ?? startTs;
    let until = bounds.until ?? now;
    if (since > until) {
      // WHY: swap the input values too, so the correction is visible and the
      // next apply is already in the corrected order (PBI: 補正される).
      startInput.value = endValue;
      endInput.value = startValue;
      bounds = customRangeToBounds(endValue, startValue, now);
      since = bounds.since ?? endTs;
      until = bounds.until ?? now;
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

    // WHY: the window is resolved before the load so a rejected window shows
    // its validation message WITHOUT invalidating an apply already in flight.
    // The halves ride along as panel state instead of a load argument because
    // the ring's per-load channel carries a period range, not this panel's
    // two half-windows.
    pendingHalves = halves;
    await lifecycle.reload();
  }

  const lifecycle = createAsyncDataPanelLifecycle({
    label: 'tagClusterTimeSliderPanel',
    // WHY: each compared half is its own notice scope.
    notices: [firstNotices, secondNotices],
    // WHY: no filter host selector — this panel owns its own two date inputs
    // and validates them before a load, so the ring's range is unused.
    isReady: () =>
      startInput !== null &&
      endInput !== null &&
      first.svg !== null &&
      second.svg !== null,
    resetOutput: () => {
      clearSideSvg(first);
      clearSideSvg(second);
    },
    // WHY: isReady() already gated this load; the check narrows the captured
    // hosts for the body.
    load: async ({ isStale }) => {
      const firstSvg = first.svg;
      const secondSvg = second.svg;
      const halves = pendingHalves;
      if (!firstSvg || !secondSvg || !halves) return;
      setStatus('tagClusterTimeSliderLoading', 'Comparing tag clusters…');
      const firstLoading = new TagClusterLoadingManager(firstSvg);
      const secondLoading = new TagClusterLoadingManager(secondSvg);

      // WHY: the two halves are independent queries — run them in parallel
      // (Promise.all) instead of serially, or every Compare click waits twice
      // the wall-clock for capped queries plus two co-occurrence pipelines.
      const [firstData, secondData] = await Promise.all([
        fetchSide(first, firstNotices, halves.first, isStale, 'tagClusterTimeSliderFirst', firstLoading),
        fetchSide(second, secondNotices, halves.second, isStale, 'tagClusterTimeSliderSecond', secondLoading),
      ]);
      if (isStale()) return;

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
    },
    teardown: () => {
      first.panZoom?.cleanup();
      second.panZoom?.cleanup();
      first = createEmptySideRefs();
      second = createEmptySideRefs();
    },
  });

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
        zoomInBtn: container.querySelector('#tagCompareFirstZoomIn'),
        zoomOutBtn: container.querySelector('#tagCompareFirstZoomOut'),
        zoomResetBtn: container.querySelector('#tagCompareFirstZoomReset'),
      };
      second = {
        ...createEmptySideRefs(),
        svg: container.querySelector('#tagCompareSecondSvg') as unknown as SVGSVGElement | null,
        zoomInBtn: container.querySelector('#tagCompareSecondZoomIn'),
        zoomOutBtn: container.querySelector('#tagCompareSecondZoomOut'),
        zoomResetBtn: container.querySelector('#tagCompareSecondZoomReset'),
      };

      firstNotices.register('empty', container.querySelector('#tagCompareFirstEmpty'), {
        i18nKey: 'tagClusterCompareEmptyPeriod',
        fallbackText: 'No records in this half of the window.',
      });
      firstNotices.register('truncated', container.querySelector('#tagCompareFirstTruncated'));
      firstNotices.register('rowCap', container.querySelector('#tagCompareFirstCapNotice'), {
        fetchScoped: true,
      });
      secondNotices.register('empty', container.querySelector('#tagCompareSecondEmpty'), {
        i18nKey: 'tagClusterCompareEmptyPeriod',
        fallbackText: 'No records in this half of the window.',
      });
      secondNotices.register('truncated', container.querySelector('#tagCompareSecondTruncated'));
      secondNotices.register('rowCap', container.querySelector('#tagCompareSecondCapNotice'), {
        fetchScoped: true,
      });

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
      lifecycle.destroy();
      pendingHalves = null;
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
