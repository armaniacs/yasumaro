// @vitest-environment jsdom
/**
 * researchReportPanelView.test.ts (PBI 2026-11-01-03)
 * Research-report region: the report target (term/tag/period) resolves from
 * the SELECTED SAVED COLLECTION — never from the history shell's current
 * search conditions. The history region render stays selector-free; the new
 * standalone panel region renders the target select and generates through
 * the existing exportResearchReport seam (top-200 cap, unread holes, reason
 * paint and resend preserved).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../messaging/researchReportGateway.js', () => ({
  exportResearchReport: vi.fn(),
}));

import { exportResearchReport } from '../../../../messaging/researchReportGateway.js';
import { tOrKey as t } from '../../../../utils/i18n.js';
import {
  RESEARCH_REPORT_REGION_ID,
  buildResearchReportScopeFromCollection,
  createResearchReportActions,
  createResearchReportPanelActions,
  renderResearchReportRegion,
  renderResearchReportPanelRegion,
} from '../researchReportPanelView.js';
import type { SavedCollection } from '../../../../utils/storage/savedCollections.js';

const mockedReport = exportResearchReport as unknown as ReturnType<typeof vi.fn>;

function collection(
  id: string,
  name: string,
  updatedAt: number,
  query: Record<string, unknown> = {},
): SavedCollection {
  return { id, name, query, createdAt: updatedAt, updatedAt };
}

function mountHistoryRegion(): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = `<div id="${RESEARCH_REPORT_REGION_ID}"></div>`;
  document.body.appendChild(container);
  return container;
}

function mountPanelRegion(regionId: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = `<div id="${regionId}"></div>`;
  document.body.appendChild(container);
  return container;
}

function panelControls(section: HTMLElement): {
  target: HTMLSelectElement;
  button: HTMLButtonElement;
  check: HTMLInputElement;
} {
  const target = section.querySelector<HTMLSelectElement>('.research-report-target');
  const button = section.querySelector<HTMLButtonElement>('[data-report-action="generate"]');
  const check = section.querySelector<HTMLInputElement>('.research-report-obsidian-check');
  expect(target).not.toBeNull();
  expect(button).not.toBeNull();
  expect(check).not.toBeNull();
  return { target: target!, button: button!, check: check! };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedReport.mockResolvedValue({ success: true, recordCount: 3 });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('buildResearchReportScopeFromCollection — collection-to-conditions resolution', () => {
  it('maps the stored search/tag/day to the report scope (語・タグ・期間)', () => {
    const scope = buildResearchReportScopeFromCollection({
      search: 'wasm',
      tag: 'tools',
      date: '2026-10-23',
    });
    expect(scope.search).toBe('wasm');
    expect(scope.tag).toBe('tools');
    expect(typeof scope.since).toBe('number');
    expect(typeof scope.until).toBe('number');
    expect(scope.since).toBeLessThanOrEqual(scope.until);
  });

  it('keeps an empty stored query as the empty scope (whole-history, capped downstream)', () => {
    expect(buildResearchReportScopeFromCollection({})).toEqual({});
  });

  it('fails closed on a corrupted stored query (no history conditions leak in)', () => {
    expect(
      buildResearchReportScopeFromCollection({ search: 42, tag: '   ', date: 'bogus-date' }),
    ).toEqual({});
  });

  it('drops a non-finite day range instead of sending NaN to the gateway', () => {
    const scope = buildResearchReportScopeFromCollection({ search: 'wasm', date: 'bogus-date' });
    expect(scope.search).toBe('wasm');
    expect(scope.since).toBeUndefined();
    expect(scope.until).toBeUndefined();
  });
});

describe('createResearchReportPanelActions — panel owns collection → generate', () => {
  it('resolves the selected collection to the scope and keeps the seam call shape', async () => {
    const stored = {
      c1: collection('c1', 'Rust notes', 2, { search: 'wasm', tag: 'tools' }),
    };
    const actions = createResearchReportPanelActions(() => stored);
    const result = await actions.onGenerate('c1', false);
    expect(mockedReport).toHaveBeenCalledWith({
      scope: { search: 'wasm', tag: 'tools' },
      sendToObsidian: false,
    });
    expect(result.ok).toBe(true);
  });

  it('sends the empty scope for the all-records target (no history state read)', async () => {
    const actions = createResearchReportPanelActions(() => ({}));
    await actions.onGenerate(null, true);
    expect(mockedReport).toHaveBeenCalledWith({ scope: {}, sendToObsidian: true });
  });

  it('degrades an unknown collection id to the empty scope without throwing', async () => {
    const actions = createResearchReportPanelActions(() => ({}));
    const result = await actions.onGenerate('missing', false);
    expect(mockedReport).toHaveBeenCalledWith({ scope: {}, sendToObsidian: false });
    expect(result.ok).toBe(true);
  });

  it('surfaces the gateway failure reason raw (no translation, as before)', async () => {
    mockedReport.mockResolvedValueOnce({ success: false, error: 'report boom' });
    const actions = createResearchReportPanelActions(() => ({}));
    const result = await actions.onGenerate(null, false);
    expect(result).toEqual({ ok: false, error: 'report boom' });
  });
});

describe('renderResearchReportRegion — history path stays selector-free', () => {
  it('renders the generate control with no collection select (PBI 04 owns the slimming)', () => {
    const container = mountHistoryRegion();
    renderResearchReportRegion(container, createResearchReportActions(() => ({
      searchQuery: 'wasm',
      activeTagFilter: null,
      selectedDate: null,
    })));

    expect(container.querySelector('.research-report-target')).toBeNull();
    expect(container.querySelector('[data-report-action="generate"]')).not.toBeNull();
    expect(container.querySelector('.research-report-obsidian-check')).not.toBeNull();
  });
});

describe('renderResearchReportPanelRegion — standalone region move', () => {
  it('lists the saved collections as report targets behind the all-targets option', () => {
    const container = mountPanelRegion('research-report-panel-region');
    renderResearchReportPanelRegion(
      container,
      {
        c1: collection('c1', 'Rust notes', 2, { search: 'wasm' }),
        c2: collection('c2', 'Wasm lab', 1, { tag: 'tools' }),
      },
      createResearchReportPanelActions(() => ({})),
      'research-report-panel-region',
    );

    const options = [...container.querySelectorAll<HTMLOptionElement>('.research-report-target option')];
    expect(options.map((o) => o.value)).toEqual(['', 'c1', 'c2']);
    expect(options.map((o) => o.textContent)).toContain('Rust notes');
    expect(container.querySelector('#research-report-panel-region [data-report-action="generate"]')).not.toBeNull();
  });

  it('generates from the selected collection (BDD 4節Markdownへの生成)', async () => {
    const stored = {
      c1: collection('c1', 'Rust notes', 2, { search: 'wasm', tag: 'tools' }),
    };
    const container = mountPanelRegion('research-report-panel-region');
    renderResearchReportPanelRegion(
      container,
      stored,
      createResearchReportPanelActions(() => stored),
      'research-report-panel-region',
    );

    const { target, button } = panelControls(container);
    target.value = 'c1';
    button.click();

    await vi.waitFor(() => {
      expect(mockedReport).toHaveBeenCalledWith({
        scope: { search: 'wasm', tag: 'tools' },
        sendToObsidian: false,
      });
    });
    await vi.waitFor(() => {
      expect(container.querySelector('.research-report-status')?.textContent).toBe(
        t('researchReportDone', ['3']),
      );
    });
  });

  it('paints the no-target reason and creates no file on failure (BDD 対象なし)', async () => {
    mockedReport.mockResolvedValueOnce({ success: false, error: 'no matching records' });
    const container = mountPanelRegion('research-report-panel-region');
    renderResearchReportPanelRegion(
      container,
      {},
      createResearchReportPanelActions(() => ({})),
      'research-report-panel-region',
    );

    panelControls(container).button.click();

    await vi.waitFor(() => {
      expect(container.querySelector('.research-report-status')?.textContent).toBe('no matching records');
    });
  });

  it('paints the failure reason and resends on the next generate (BDD 再送)', async () => {
    mockedReport.mockResolvedValueOnce({ success: false, error: 'send down' });
    mockedReport.mockResolvedValueOnce({ success: true, recordCount: 5, deliveredTo: ['obsidian'] });
    const container = mountPanelRegion('research-report-panel-region');
    renderResearchReportPanelRegion(
      container,
      {},
      createResearchReportPanelActions(() => ({})),
      'research-report-panel-region',
    );

    const { button, check } = panelControls(container);
    check.checked = true;
    button.click();
    await vi.waitFor(() => {
      expect(container.querySelector('.research-report-status')?.textContent).toBe('send down');
    });
    expect(button.disabled).toBe(false);

    button.click();
    await vi.waitFor(() => {
      expect(mockedReport).toHaveBeenCalledTimes(2);
    });
    expect(mockedReport.mock.calls[1]?.[0]).toEqual({ scope: {}, sendToObsidian: true });
    await vi.waitFor(() => {
      expect(container.querySelector('.research-report-status')?.textContent).toBe(
        t('researchReportDone', ['5']),
      );
    });
  });
});
