// @vitest-environment jsdom
/**
 * researchReportPanel.test.ts (PBI 2026-11-01-03)
 * New sibling panel `panel-research-report`: owns the target collection
 * selection with panel-local state (no history dependence). The collection
 * list loads DIRECTLY from the saved-collections repository; generation
 * reuses the existing exportResearchReport path (reason paint, retry).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../messaging/researchReportGateway.js', () => ({
  exportResearchReport: vi.fn(),
}));

vi.mock('../../../../utils/storage/savedCollectionsRepository.js', () => ({
  getSavedCollections: vi.fn().mockResolvedValue({}),
}));

import { exportResearchReport } from '../../../../messaging/researchReportGateway.js';
import { getSavedCollections } from '../../../../utils/storage/savedCollectionsRepository.js';
import {
  createResearchReportPanel,
  RESEARCH_REPORT_PANEL_REGION_ID,
} from '../researchReportPanel.js';
import type { SavedCollection } from '../../../../utils/storage/savedCollections.js';

const mockedReport = exportResearchReport as unknown as ReturnType<typeof vi.fn>;
const mockedGetSaved = getSavedCollections as unknown as ReturnType<typeof vi.fn>;

function collection(
  id: string,
  name: string,
  updatedAt: number,
  query: Record<string, unknown> = {},
): SavedCollection {
  return { id, name, query, createdAt: updatedAt, updatedAt };
}

function mountSection(): HTMLElement {
  const section = document.createElement('section');
  section.id = 'panel-research-report';
  // No history-shell ids here by design: the panel must work standalone.
  section.innerHTML = `<div id="${RESEARCH_REPORT_PANEL_REGION_ID}"></div>`;
  document.body.appendChild(section);
  return section;
}

function reportControls(section: HTMLElement): {
  target: HTMLSelectElement;
  button: HTMLButtonElement;
} {
  const target = section.querySelector<HTMLSelectElement>('.research-report-target');
  const button = section.querySelector<HTMLButtonElement>('[data-report-action="generate"]');
  expect(target).not.toBeNull();
  expect(button).not.toBeNull();
  return { target: target!, button: button! };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetSaved.mockResolvedValue({});
  mockedReport.mockResolvedValue({ success: true, recordCount: 3 });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('researchReportPanel — PanelLifecycle', () => {
  it('declares the new panel id and async-data category', () => {
    const panel = createResearchReportPanel();
    expect(panel.id).toBe('panel-research-report');
    expect(panel.category).toBe('async-data');
  });

  it('mount → load → destroy succeeds with no collections (BDD 空状態)', async () => {
    const panel = createResearchReportPanel();
    const section = mountSection();
    panel.mount(section);
    await panel.load?.();
    const { target } = reportControls(section);
    expect([...target.options].map((o) => o.value)).toEqual(['']);
    expect(() => panel.destroy?.()).not.toThrow();
  });

  it('load without a prior mount resolves (registry safety)', async () => {
    const panel = createResearchReportPanel();
    await expect(panel.load?.()).resolves.toBeUndefined();
  });
});

describe('researchReportPanel — collection list loads directly (no history state)', () => {
  it('lists the repository collections as report targets', async () => {
    mockedGetSaved.mockResolvedValue({
      c1: collection('c1', 'Rust notes', 2, { search: 'wasm' }),
      c2: collection('c2', 'Wasm lab', 1, { tag: 'tools' }),
    });
    const panel = createResearchReportPanel();
    const section = mountSection();
    panel.mount(section);
    await panel.load?.();

    expect(mockedGetSaved).toHaveBeenCalledTimes(1);
    const { target } = reportControls(section);
    expect([...target.options].map((o) => o.value)).toEqual(['', 'c1', 'c2']);
    panel.destroy?.();
  });

  it('renders the load reason inside the panel and resolves instead of throwing', async () => {
    mockedGetSaved.mockRejectedValueOnce(new Error('db down'));
    const panel = createResearchReportPanel();
    const section = mountSection();
    panel.mount(section);
    await expect(panel.load?.()).resolves.toBeUndefined();

    const alert = section.querySelector('.research-report-load-error');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toContain('db down');
    panel.destroy?.();
  });
});

describe('researchReportPanel — target resolution and generation (BDD 生成・理由・送付)', () => {
  it('generates with the scope resolved from the selected collection', async () => {
    mockedGetSaved.mockResolvedValue({
      c1: collection('c1', 'Rust notes', 2, { search: 'wasm', tag: 'tools', date: '2026-10-23' }),
    });
    const panel = createResearchReportPanel();
    const section = mountSection();
    panel.mount(section);
    await panel.load?.();

    const { target, button } = reportControls(section);
    target.value = 'c1';
    button.click();

    await vi.waitFor(() => {
      expect(mockedReport).toHaveBeenCalledTimes(1);
    });
    const params = mockedReport.mock.calls[0]?.[0] as { scope: Record<string, unknown> };
    expect(params.scope).toMatchObject({ search: 'wasm', tag: 'tools' });
    expect(typeof params.scope['since']).toBe('number');
    expect(typeof params.scope['until']).toBe('number');
    panel.destroy?.();
  });
});
