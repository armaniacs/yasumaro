// @vitest-environment jsdom
/**
 * dashboardLegacyPanelFactories.test.ts
 * PBI 2026-09-29-40 (partial): the three legacy dashboard modules that carried
 * module-level mutable DOM state now hand out instances that own it and can
 * release it.
 *
 * What is pinned here, per module:
 * - destroy() detaches every listener init() attached (no stale node survives),
 * - a later init() re-resolves from the document, so re-mount after destroy works,
 * - two instances do not share state, so one teardown cannot un-wire another.
 *
 * The static-form mount path is asserted through staticPanels: the specs must
 * keep routing through staticPanelAdapter rather than calling a factory
 * directly, so a test that mounts a panel the production way still works.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── shared mocks ────────────────────────────────────────────────────────────
// WHY hoisted: every value a `vi.mock` factory closes over is hoisted above the
// factory's own initialization, so a plain top-level const would be in TDZ when
// the factory first runs.
const {
  mockAddSensitiveDomain,
  mockInitialize,
  mockGetSensitiveDomains,
  mockRepoSet,
  mockRepoSetAll,
  mockShowStatus,
} = vi.hoisted(() => ({
  mockAddSensitiveDomain: vi.fn(() => Promise.resolve({ success: true })),
  mockInitialize: vi.fn(() => Promise.resolve()),
  mockGetSensitiveDomains: vi.fn((cat: string) => [`${cat}.example`]),
  mockRepoSet: vi.fn(() => Promise.resolve()),
  mockRepoSetAll: vi.fn(() => Promise.resolve()),
  mockShowStatus: vi.fn(),
}));

vi.mock('../../utils/trustDb/TrustDbAdmin.js', () => ({
  getTrustDbAdmin: vi.fn(() => ({
    initialize: mockInitialize,
    getDatabase: vi.fn(() => ({ tranco: { tier: 'top10k', count: 1, lastUpdated: 'x' }, lastUpdated: 'x' })),
    getJpAnchorTlds: vi.fn(() => []),
    getSensitiveDomains: mockGetSensitiveDomains,
    getWhitelist: vi.fn(() => []),
    addJpAnchorTld: vi.fn(() => Promise.resolve({ success: true })),
    removeJpAnchorTld: vi.fn(() => Promise.resolve()),
    addSensitiveDomain: mockAddSensitiveDomain,
    removeSensitiveDomain: vi.fn(() => Promise.resolve()),
    addToWhitelist: vi.fn(() => Promise.resolve({ success: true })),
    removeFromWhitelist: vi.fn(() => Promise.resolve()),
  })),
}));

vi.mock('../../utils/trustDb/trancoUpdater.js', () => ({
  getTrancoUpdater: vi.fn(() => ({
    isUpdateInProgress: vi.fn(() => false),
    updateTrancoList: vi.fn(() => Promise.resolve({ success: true, domainsCount: 1 })),
  })),
}));

vi.mock('../../utils/trustChecker.js', () => ({
  getTrustChecker: vi.fn(() => ({
    getAlertConfig: vi.fn(() => Promise.resolve({ alertFinance: false, alertSensitive: false, alertUnverified: false })),
    saveAlertSettings: vi.fn(() => Promise.resolve()),
  })),
}));

vi.mock('../../utils/permissionManager.js', () => ({
  getFrequentDeniedDomains: vi.fn(() => Promise.resolve([])),
  requestPermission: vi.fn(() => Promise.resolve(true)),
  removeDeniedDomain: vi.fn(() => Promise.resolve()),
  recordDomainDismissal: vi.fn(() => Promise.resolve()),
  isHostPermitted: vi.fn(() => Promise.resolve(false)),
}));

vi.mock('../../utils/i18n.js', () => {
  const getMessage = vi.fn((key: string) => key);
  const getMessageOr = (key: string, fallback: string, subs?: unknown): string =>
    (((subs === undefined ? getMessage(key) : getMessage(key, subs)) || fallback)) as string;
  return {
    getMessage,
    getMessageOr,
    getMessageWithSubstitutions: (key: string, _subs: Record<string, string | number>, fallback: string) =>
      (getMessage(key) || fallback) as string,
    getUserLocale: vi.fn(() => 'en'),
    isRTL: vi.fn(() => false),
  };
});

vi.mock('../../utils/logger/api.js', () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock('../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    settingsRepository: {
      getAll: vi.fn(() => Promise.resolve({})),
      get: vi.fn(),
      set: mockRepoSet,
      setAll: mockRepoSetAll,
    },
  };
});

vi.mock('../../utils/ui/settingsUiHelper.js', () => ({ showStatus: mockShowStatus }));

vi.mock('../../utils/ui/confirmDialog.js', () => ({
  showConfirmDialog: vi.fn(() => Promise.resolve(true)),
  showAlertDialog: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('../../utils/i18n-dom.js', () => ({ applyI18n: vi.fn() }));

vi.mock('../../utils/customPromptUtils.js', () => ({
  createPrompt: vi.fn((data: Record<string, unknown>) => ({
    id: 'created-1', createdAt: 1, updatedAt: 1, ...data,
  })),
  updatePrompt: vi.fn((prompts: unknown[]) => prompts),
  deletePrompt: vi.fn((prompts: unknown[]) => prompts),
  setActivePrompt: vi.fn((prompts: unknown[]) => prompts),
  validatePrompt: vi.fn(() => ({ valid: true })),
  DEFAULT_USER_PROMPT: 'Default user prompt',
  DEFAULT_SYSTEM_PROMPT: 'Default system prompt',
  PRESET_PROMPTS: [],
  getPresetPrompt: vi.fn(() => undefined),
  getPromptDisplayName: vi.fn(() => 'Default'),
}));

import { createTrustSettings } from '../settings/trustSettings.js';
import { createCustomPromptManager } from '../settings/customPromptManager.js';
import { createMarkdownTemplateManager } from '../markdownTemplateManager.js';
import { STATIC_FORM_SPECS, createStaticPanelById } from '../panels/staticForm/staticPanels.js';
import { drainMacrotask, waitForMock } from '../../../testDir/waitPolicy.js';
import type { Settings } from '../../utils/storage/types.js';

// jsdom implements no layout, so scrollIntoView is absent; the panel calls it
// to bring the editor into view.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
}

const settings = { custom_prompts: [] } as unknown as Settings;

function trustDom(): void {
  document.body.innerHTML = `
    <select id="safetyMode"><option value="strict">S</option><option value="balanced">B</option></select>
    <select id="trancoTier"><option value="top1k">1k</option><option value="top10k">10k</option></select>
    <div id="trancoStatus"></div>
    <button id="updateTrancoBtn"></button>
    <div id="jpAnchorList"></div>
    <input id="jpAnchorAdd" /><button id="jpAnchorAddBtn"></button>
    <div id="sensitiveList"></div>
    <select id="sensitiveCategory"><option value="finance">finance</option><option value="gaming">gaming</option></select>
    <input id="sensitiveAdd" /><button id="sensitiveAddBtn"></button>
    <div id="whitelist"></div>
    <input id="whitelistAdd" /><button id="whitelistAddBtn"></button>
    <input type="checkbox" id="alertFinance" />
    <input type="checkbox" id="alertSensitive" />
    <input type="checkbox" id="alertUnverified" />
    <button id="saveTrustSettings"></button>
    <div id="trustSettingsStatus"></div>
    <input id="permissionThreshold" value="3" />
    <div id="permissionSuggestSection"></div>
    <div id="permissionSuggestList"></div>
    <button class="category-tab" data-category="finance"></button>
    <button class="category-tab" data-category="gaming"></button>
  `;
}

function promptDom(): void {
  document.body.innerHTML = `
    <div id="promptList"></div>
    <div id="noPromptsMessage"></div>
    <input id="promptName" value="P" />
    <select id="promptProvider"><option value="all">All</option><option value="gemini">Gemini</option></select>
    <input id="promptSystem" />
    <textarea id="promptText">text</textarea>
    <input id="editingPromptId" />
    <button id="savePromptBtn"></button>
    <button id="cancelPromptBtn"></button>
    <div id="promptStatus"></div>
  `;
}

function templateDom(): void {
  document.body.innerHTML = `
    <div id="markdownTemplateList"></div>
    <div id="markdownTemplateEditor" class="hidden"></div>
    <input id="markdownTemplateName" />
    <textarea id="markdownTemplateFileInput"></textarea>
    <textarea id="markdownTemplateEntryInput"></textarea>
    <div id="markdownTemplatePreview"></div>
    <div id="markdownTemplateEditorError"></div>
    <div id="markdownTemplateStatus"></div>
    <button id="markdownTemplateCreateBtn"></button>
    <button id="markdownTemplateSaveBtn"></button>
    <button id="markdownTemplateCancelBtn"></button>
  `;
}

function click(id: string): void {
  document.getElementById(id)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

/**
 * The click handler `init` registered on `id`, and a spy on the matching
 * removeEventListener.
 *
 * A click after destroy() cannot prove the teardown on its own: the handlers
 * also short-circuit once the instance released its state, so a leaked
 * listener stays invisible. Comparing the exact function reference handed to
 * addEventListener against the one handed to removeEventListener is the only
 * observation that distinguishes "detached" from "inert".
 */
function trackClickListener(id: string): {
  added: () => unknown;
  removed: ReturnType<typeof vi.spyOn>;
} {
  const el = document.getElementById(id) as HTMLElement;
  const addSpy = vi.spyOn(el, 'addEventListener');
  const removeSpy = vi.spyOn(el, 'removeEventListener');
  return {
    added: () => addSpy.mock.calls.find(([type]) => type === 'click')?.[1],
    removed: removeSpy,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('createTrustSettings lifecycle', () => {
  it('destroy() detaches the listeners init() attached', async () => {
    trustDom();
    const controller = createTrustSettings();

    controller.init();
    click('sensitiveAddBtn');
    await waitForMock(() => expect(mockAddSensitiveDomain).toHaveBeenCalledTimes(1));

    controller.destroy();
    click('sensitiveAddBtn');
    // The handler awaits db.initialize() before it reaches the admin, so the
    // negative is only meaningful once that microtask chain has run.
    await drainMacrotask();
    expect(mockAddSensitiveDomain).toHaveBeenCalledTimes(1);
  });

  it('re-mounts after destroy(): a later init() re-resolves the DOM', async () => {
    trustDom();
    const controller = createTrustSettings();

    controller.init();
    controller.destroy();
    // The document was replaced between the two mounts, exactly what a
    // re-created options page does.
    trustDom();
    controller.init();
    click('sensitiveAddBtn');

    await waitForMock(() => expect(mockAddSensitiveDomain).toHaveBeenCalledTimes(1));
  });

  it('keeps two instances independent', async () => {
    trustDom();
    const first = createTrustSettings();
    const second = createTrustSettings();

    first.init();
    second.init();
    first.destroy();
    click('sensitiveAddBtn');

    // The surviving instance still owns the live listener.
    await waitForMock(() => expect(mockAddSensitiveDomain).toHaveBeenCalledTimes(1));
  });

  it('tracks the active category per instance, not per module', async () => {
    trustDom();
    const controller = createTrustSettings();
    controller.init();

    document.querySelector<HTMLButtonElement>('[data-category="gaming"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // switchCategory reads the DB, then re-renders. A 'finance' selection that
    // leaked from another instance would re-add the finance row instead.
    const list = document.getElementById('sensitiveList')!;
    await waitForMock(() => expect(list.textContent).toContain('gaming.example'));
    expect(list.textContent).not.toContain('finance.example');
  });
});

describe('createCustomPromptManager lifecycle', () => {
  it('destroy() removes exactly the click listeners init() registered', () => {
    promptDom();
    const save = trackClickListener('savePromptBtn');
    const cancel = trackClickListener('cancelPromptBtn');

    const manager = createCustomPromptManager();
    manager.init(settings);
    const saveHandler = save.added();
    const cancelHandler = cancel.added();
    expect(saveHandler).toBeDefined();
    expect(cancelHandler).toBeDefined();

    manager.destroy();

    expect(save.removed).toHaveBeenCalledWith('click', saveHandler);
    expect(cancel.removed).toHaveBeenCalledWith('click', cancelHandler);
  });

  it('destroy() is idempotent: a second call detaches nothing new', () => {
    promptDom();
    const save = trackClickListener('savePromptBtn');
    const manager = createCustomPromptManager();
    manager.init(settings);
    manager.destroy();

    save.removed.mockClear();
    manager.destroy();

    expect(save.removed).not.toHaveBeenCalled();
  });

  it('loadDefaultPrompt() after destroy() is a no-op instead of writing to a detached node', () => {
    promptDom();
    const manager = createCustomPromptManager();
    manager.init(settings);

    const text = document.getElementById('promptText') as HTMLTextAreaElement;
    text.value = 'edited';
    manager.destroy();
    manager.loadDefaultPrompt();

    // The instance holds no reference after destroy, so the stale node is
    // untouched — no DOM write escapes a torn-down panel.
    expect(text.value).toBe('edited');
  });
});

describe('createMarkdownTemplateManager lifecycle', () => {
  it('destroy() removes exactly the click listeners init() registered', () => {
    templateDom();
    const create = trackClickListener('markdownTemplateCreateBtn');
    const save = trackClickListener('markdownTemplateSaveBtn');
    const cancel = trackClickListener('markdownTemplateCancelBtn');

    const manager = createMarkdownTemplateManager();
    manager.init(settings);
    const handlers = {
      create: create.added(),
      save: save.added(),
      cancel: cancel.added(),
    };
    expect(handlers.create).toBeDefined();
    expect(handlers.save).toBeDefined();
    expect(handlers.cancel).toBeDefined();

    manager.destroy();

    expect(create.removed).toHaveBeenCalledWith('click', handlers.create);
    expect(save.removed).toHaveBeenCalledWith('click', handlers.save);
    expect(cancel.removed).toHaveBeenCalledWith('click', handlers.cancel);
  });

  it('init() after destroy() re-attaches the buttons to a rebuilt DOM', () => {
    templateDom();
    const manager = createMarkdownTemplateManager();
    manager.init(settings);

    click('markdownTemplateCreateBtn');
    expect(document.getElementById('markdownTemplateEditor')!.classList.contains('hidden')).toBe(false);

    manager.destroy();
    templateDom();
    manager.init(settings);
    click('markdownTemplateCreateBtn');

    expect(document.getElementById('markdownTemplateEditor')!.classList.contains('hidden')).toBe(false);
  });
});

describe('static-form mount path', () => {
  it('the three migrated panels still mount through staticPanelAdapter', async () => {
    trustDom();
    promptDom();
    templateDom();

    for (const id of ['panel-trust', 'panel-prompt', 'panel-markdown-template'] as const) {
      const panel = createStaticPanelById(id);
      await panel.mount(document.body);
      expect(panel.id).toBe(id);
    }
  });

  it('the specs stay declarative (mount only, no direct factory wiring)', () => {
    expect(Object.keys(STATIC_FORM_SPECS)).toEqual(
      expect.arrayContaining(['panel-trust', 'panel-prompt', 'panel-markdown-template']),
    );
    for (const id of ['panel-trust', 'panel-prompt', 'panel-markdown-template'] as const) {
      expect(STATIC_FORM_SPECS[id].id).toBe(id);
      expect(typeof STATIC_FORM_SPECS[id].mount).toBe('function');
    }
  });
});
