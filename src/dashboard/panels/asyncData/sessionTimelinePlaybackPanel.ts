/**
 * sessionTimelinePlaybackPanel.ts (PanelLifecycle)
 *
 * Session-restoration playback panel wiring (PBI 2026-10-22-04, O1).
 * The pure model + render live in sessionTimelinePanel.ts (jsdom-tested,
 * zero chrome usage); this factory is the catalog registration: fetch
 * (fetchPeriodRows, the shared dashboard read seam) → isStale → render,
 * following the similarityClusterPanel skeleton. No period filter: a session
 * trail spans whatever window the user walked away from, so the read is one
 * capped all-time query (the same window the reminder candidate provider
 * reads, so the panel view and the notification agree on which records
 * exist).
 *
 * onOpenRecord reaches the history panel (the registry owner's route, one
 * jump): the button carries the row id, the factory maps id → domain from
 * the rendered model, and a record with a domain filters the history panel;
 * a domain-less record navigates plain (the history panel's own init
 * contract: unset search params load unfiltered).
 *
 * Labels are i18n keyed (R-06 残: the fixed-English heading is keyed too)
 * with the panel's English fallbacks, so a missing locale key degrades to
 * the same strings the pure module renders by default.
 */

import {
  buildPlaybackModel,
  renderPlayback,
  type PlaybackLabels,
} from '../../sessionTimelinePanel.js';
import { getMessageOr } from '../../../utils/i18n.js';
import { clearElement } from '../../../utils/domClear.js';
import { MAX_QUERY_ROWS } from '../../../utils/computeLimits.js';
import { fetchPeriodRows } from '../fetchPeriodRows.js';
import { createAsyncDataPanelLifecycle } from './asyncDataPanelLifecycle.js';
import { tryNavigateTyped } from '../registryContext.js';
import { type PanelLifecycle } from '../types.js';

/** Labels from i18n with the pure module's English defaults as fallbacks. */
export function playbackLabels(): PlaybackLabels {
  return {
    emptySessions: getMessageOr(
      'sessionTimelineEmptySessions',
      'No sessions yet. Visit pages from one search or one link to build a trail.',
    ),
    openRecord: getMessageOr('sessionTimelineOpenRecord', 'Open record'),
    fromSource: getMessageOr('sessionTimelineFromSource', 'From'),
    sessionHeading: getMessageOr(
      'sessionTimelineSessionHeading',
      'Session {index} ({basis}, {count} pages)',
    ),
    basisSearchQuery: getMessageOr('sessionTimelineBasisSearch', 'search query'),
    basisNavSourceUrl: getMessageOr('sessionTimelineBasisSource', 'link source'),
  };
}

export function createSessionTimelinePanel(): PanelLifecycle {
  let listEl: HTMLElement | null = null;

  const lifecycle = createAsyncDataPanelLifecycle({
    label: 'sessionTimelinePanel',
    notices: [],
    isReady: () => listEl !== null,
    resetOutput: () => {
      clearElement(listEl);
    },
    load: async ({ isStale }) => {
      if (!listEl) return;
      const fetched = await fetchPeriodRows({ limit: MAX_QUERY_ROWS, label: 'sessionTimeline' });
      if (isStale()) return;
      const model = buildPlaybackModel(fetched.rows);
      // The open-record button carries the row id; the domain map lets the
      // hook filter the history panel without widening the render contract.
      const domainByRecordId = new Map<number, string>();
      for (const session of model.sessions) {
        for (const record of session.records) {
          domainByRecordId.set(record.id, record.domain);
        }
      }
      renderPlayback(listEl, model.sessions, {
        onOpenRecord: (recordId) => {
          const domain = domainByRecordId.get(recordId) ?? '';
          if (domain !== '') {
            tryNavigateTyped('panel-sqlite-history', { searchDomain: domain });
          } else {
            tryNavigateTyped('panel-sqlite-history');
          }
        },
      }, playbackLabels());
    },
  });

  return {
    id: 'panel-session-timeline',
    category: 'async-data',
    mount(container) {
      listEl = container.querySelector('#sessionPlaybackList');
      lifecycle.mount(container);
    },
    async load() {
      await lifecycle.reload();
    },
    destroy() {
      lifecycle.destroy();
      listEl = null;
    },
  };
}
