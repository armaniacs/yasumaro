// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StorageKeys } from '../../../utils/storage/types.js';

// Mock dashboardSqliteService before importing settingsForm
vi.mock('../../dashboardSqliteService.js', async (importOriginal) => {
  const orig = (await importOriginal()) as any;
  return {
    ...orig,
    purgeOldRecordsNow: vi.fn(),
    purgeContentNow: vi.fn(),
    // keep real isServiceError but allow spying
    isServiceError: orig.isServiceError,
  };
});

vi.mock('../../../utils/i18n.js', async (importOriginal) => {
  const orig = (await importOriginal()) as any;
  return {
    ...orig,
    getMessage: vi.fn((key: string) => {
      // default: return key for non-empty, to allow fallback testing we override per test
      // but for coverage we return a non-empty string for known keys
      const map: Record<string, string> = {
        purgeNowSkipped: 'skipped-msg',
        contentPurgeNowSkipped: 'content-skipped-msg',
        purgeNowSuccess_one: 'purged-one $COUNT$',
        purgeNowSuccess_other: 'purged-other $COUNT$',
        contentPurgeNowSuccess_one: 'content-one $COUNT$',
        contentPurgeNowSuccess_other: 'content-other $COUNT$',
        purgeNowSuccess: 'fallback-purge',
        contentPurgeNowSuccess: 'fallback-content',
      };
      return map[key] ?? `msg:${key}`;
    }),
  };
});

vi.mock('../../../utils/i18nPlural.js', async (importOriginal) => {
  const orig = (await importOriginal()) as any;
  return {
    ...orig,
    getPluralKey: vi.fn((key: string, count: number) => {
      // mimic real logic but delegate to orig for realism; we keep mock to track calls
      return orig.getPluralKey(key, count);
    }),
  };
});

// Must import after mocks
import {
  collectProviderPrioritySlots,
  applyProviderPrioritySlots,
  loadGeneralSettings,
  handlePurgeNow,
  handleContentPurgeNow,
} from '../settingsForm.js';

import * as sqliteService from '../../dashboardSqliteService.js';
import * as i18n from '../../../utils/i18n.js';
import * as i18nPlural from '../../../utils/i18nPlural.js';
import * as settingsFormBinding from '../../../utils/settingsFormBinding.js';
import * as aiProvider from '../../settings/aiProvider.js';
import * as layoutManager from '../../aiProviderLayoutManager.js';

function createSelect(id: string, value = '', options: string[] = []): HTMLSelectElement {
  const el = document.createElement('select');
  el.id = id;
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = opt;
    el.appendChild(o);
  }
  // If value not in options, add it
  if (value && !options.includes(value)) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = value;
    el.appendChild(o);
  }
  el.value = value;
  return el;
}
function createInput(id: string, value = ''): HTMLInputElement {
  const el = document.createElement('input');
  el.id = id;
  el.value = value;
  return el;
}

describe('collectProviderPrioritySlots', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('returns empty when no elements exist', () => {
    document.body.innerHTML = '';
    expect(collectProviderPrioritySlots()).toEqual([]);
  });

  it('collects priority1 without model when model input missing or empty', () => {
    document.body.innerHTML = '';
    document.body.appendChild(createSelect('aiProvider', 'gemini', ['gemini', 'openai']));
    // no model input
    expect(collectProviderPrioritySlots()).toEqual([{ provider: 'gemini' }]);

    document.body.appendChild(createInput('aiProviderPriority1Model', '   '));
    expect(collectProviderPrioritySlots()).toEqual([{ provider: 'gemini' }]);
  });

  it('collects priority1 with model when trimmed non-empty', () => {
    document.body.innerHTML = '';
    document.body.appendChild(createSelect('aiProvider', 'openai', ['openai', 'gemini']));
    document.body.appendChild(createInput('aiProviderPriority1Model', '  gpt-4o  '));
    expect(collectProviderPrioritySlots()).toEqual([{ provider: 'openai', model: 'gpt-4o' }]);
  });

  it('does not push when select value empty', () => {
    document.body.innerHTML = '';
    document.body.appendChild(createSelect('aiProvider', '', ['gemini']));
    document.body.appendChild(createInput('aiProviderPriority1Model', 'model-x'));
    expect(collectProviderPrioritySlots()).toEqual([]);
  });

  it('collects priority2 with and without model', () => {
    document.body.innerHTML = '';
    document.body.appendChild(createSelect('aiProvider', 'gemini', ['gemini']));
    document.body.appendChild(createSelect('aiProviderPriority2', 'openai', ['openai', '']));
    document.body.appendChild(createInput('aiProviderPriority2Model', '  '));
    // model empty -> without model
    expect(collectProviderPrioritySlots()).toEqual([{ provider: 'gemini' }, { provider: 'openai' }]);

    (document.getElementById('aiProviderPriority2Model') as HTMLInputElement).value = 'gpt-4';
    expect(collectProviderPrioritySlots()).toEqual([
      { provider: 'gemini' },
      { provider: 'openai', model: 'gpt-4' },
    ]);
  });

  it('ignores priority2 when select empty', () => {
    document.body.innerHTML = '';
    document.body.appendChild(createSelect('aiProvider', 'gemini', ['gemini']));
    document.body.appendChild(createSelect('aiProviderPriority2', '', ['']));
    document.body.appendChild(createInput('aiProviderPriority2Model', 'm'));
    expect(collectProviderPrioritySlots()).toEqual([{ provider: 'gemini' }]);
  });

  it('collects priority3 with model and without', () => {
    document.body.innerHTML = '';
    document.body.appendChild(createSelect('aiProvider', 'gemini', ['gemini']));
    document.body.appendChild(createSelect('aiProviderPriority2', 'openai', ['openai']));
    document.body.appendChild(createSelect('aiProviderPriority3', 'ollama', ['ollama']));
    document.body.appendChild(createInput('aiProviderPriority3Model', 'llama3'));
    expect(collectProviderPrioritySlots()).toEqual([
      { provider: 'gemini' },
      { provider: 'openai' },
      { provider: 'ollama', model: 'llama3' },
    ]);
    // now model input missing -> without model
    document.getElementById('aiProviderPriority3Model')!.remove();
    expect(collectProviderPrioritySlots()).toEqual([
      { provider: 'gemini' },
      { provider: 'openai' },
      { provider: 'ollama' },
    ]);
  });

  it('handles all three missing or empty gracefully', () => {
    document.body.innerHTML = '';
    document.body.appendChild(createSelect('aiProvider', '', ['']));
    document.body.appendChild(createSelect('aiProviderPriority2', '', ['']));
    document.body.appendChild(createSelect('aiProviderPriority3', '', ['']));
    expect(collectProviderPrioritySlots()).toEqual([]);
  });

  it('trims model value for priority2 and 3', () => {
    document.body.innerHTML = '';
    document.body.appendChild(createSelect('aiProviderPriority2', 'openai', ['openai']));
    document.body.appendChild(createInput('aiProviderPriority2Model', '   trimmed   '));
    document.body.appendChild(createSelect('aiProviderPriority3', 'ollama', ['ollama']));
    document.body.appendChild(createInput('aiProviderPriority3Model', '   '));
    const slots = collectProviderPrioritySlots();
    expect(slots).toEqual([{ provider: 'openai', model: 'trimmed' }, { provider: 'ollama' }]);
  });
});

describe('applyProviderPrioritySlots', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('sets defaults when slots empty and elements exist', () => {
    document.body.innerHTML = '';
    document.body.appendChild(createSelect('aiProvider', 'openai', ['gemini', 'openai']));
    document.body.appendChild(createInput('aiProviderPriority1Model', 'old'));
    document.body.appendChild(createSelect('aiProviderPriority2', 'openai', ['openai', 'gemini', '']));
    document.body.appendChild(createInput('aiProviderPriority2Model', 'old2'));
    document.body.appendChild(createSelect('aiProviderPriority3', 'ollama', ['ollama', '']));
    document.body.appendChild(createInput('aiProviderPriority3Model', 'old3'));
    // empty option for priority2/3 to allow '' selection
    const optEmpty2 = document.createElement('option');
    optEmpty2.value = '';
    document.getElementById('aiProviderPriority2')!.appendChild(optEmpty2);
    const optEmpty3 = document.createElement('option');
    optEmpty3.value = '';
    document.getElementById('aiProviderPriority3')!.appendChild(optEmpty3);

    applyProviderPrioritySlots([]);
    expect((document.getElementById('aiProvider') as HTMLSelectElement).value).toBe('gemini');
    expect((document.getElementById('aiProviderPriority1Model') as HTMLInputElement).value).toBe('');
    expect((document.getElementById('aiProviderPriority2') as HTMLSelectElement).value).toBe('');
    expect((document.getElementById('aiProviderPriority3') as HTMLSelectElement).value).toBe('');
  });

  it('applies slots with models', () => {
    document.body.innerHTML = '';
    document.body.appendChild(createSelect('aiProvider', 'gemini', ['gemini', 'openai']));
    document.body.appendChild(createInput('aiProviderPriority1Model'));
    document.body.appendChild(createSelect('aiProviderPriority2', '', ['openai', 'gemini', '']));
    document.body.appendChild(createInput('aiProviderPriority2Model'));
    document.body.appendChild(createSelect('aiProviderPriority3', '', ['ollama', '']));
    document.body.appendChild(createInput('aiProviderPriority3Model'));

    applyProviderPrioritySlots([
      { provider: 'openai', model: 'gpt-4o' },
      { provider: 'gemini' },
      { provider: 'ollama', model: 'llama3' },
    ]);
    expect((document.getElementById('aiProvider') as HTMLSelectElement).value).toBe('openai');
    expect((document.getElementById('aiProviderPriority1Model') as HTMLInputElement).value).toBe('gpt-4o');
    expect((document.getElementById('aiProviderPriority2') as HTMLSelectElement).value).toBe('gemini');
    expect((document.getElementById('aiProviderPriority2Model') as HTMLInputElement).value).toBe('');
    expect((document.getElementById('aiProviderPriority3') as HTMLSelectElement).value).toBe('ollama');
    expect((document.getElementById('aiProviderPriority3Model') as HTMLInputElement).value).toBe('llama3');
  });

  it('handles missing elements without throwing', () => {
    document.body.innerHTML = '';
    // no elements at all
    expect(() => applyProviderPrioritySlots([{ provider: 'openai', model: 'x' }])).not.toThrow();
    // only some elements
    document.body.appendChild(createSelect('aiProvider', 'gemini', ['gemini', 'openai']));
    expect(() => applyProviderPrioritySlots([{ provider: 'openai' }])).not.toThrow();
    expect((document.getElementById('aiProvider') as HTMLSelectElement).value).toBe('openai');
  });

  it('covers ?? branches for each slot model', () => {
    document.body.innerHTML = '';
    document.body.appendChild(createSelect('aiProvider', 'gemini', ['gemini', 'openai']));
    document.body.appendChild(createInput('aiProviderPriority1Model'));
    document.body.appendChild(createSelect('aiProviderPriority2', '', ['gemini', '']));
    document.body.appendChild(createInput('aiProviderPriority2Model'));
    document.body.appendChild(createSelect('aiProviderPriority3', '', ['ollama', '']));
    document.body.appendChild(createInput('aiProviderPriority3Model'));

    // slot1 missing model, slot2 undefined, slot3 with undefined model
    applyProviderPrioritySlots([{ provider: 'gemini' }]);
    expect((document.getElementById('aiProviderPriority1Model') as HTMLInputElement).value).toBe('');
    expect((document.getElementById('aiProviderPriority2') as HTMLSelectElement).value).toBe('');
    expect((document.getElementById('aiProviderPriority3') as HTMLSelectElement).value).toBe('');
  });
});

describe('loadGeneralSettings', () => {
  let loadSettingsSpy: any;
  let loadTimingSpy: any;
  let visibilitySpy: any;
  let layoutSpy: any;
  let getElementsSpy: any;

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    loadSettingsSpy = vi.spyOn(settingsFormBinding, 'loadSettingsToInputs').mockImplementation(() => {});
    loadTimingSpy = vi.spyOn(settingsFormBinding, 'loadLocalMarkdownExportTiming').mockImplementation(() => {});
    visibilitySpy = vi.spyOn(aiProvider, 'updateAIProviderVisibilityMulti').mockImplementation(() => {});
    layoutSpy = vi.spyOn(layoutManager, 'updateProviderSettingsLayout').mockImplementation(() => {});
    // keep real getAiProviderElements but spy to ensure it returns object with elements if needed
    getElementsSpy = vi.spyOn(aiProvider, 'getAiProviderElements');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  function makeRepo(settings: Record<string, unknown>) {
    return {
      getAll: vi.fn().mockResolvedValue(settings),
      getMany: vi.fn(),
    };
  }

  it('loads via panel-general selector when present', async () => {
    const panel = document.createElement('div');
    panel.id = 'panel-general';
    const inner = document.createElement('input');
    inner.setAttribute('data-storage-key', StorageKeys.OBSIDIAN_ENABLED);
    panel.appendChild(inner);
    document.body.appendChild(panel);

    const repo = makeRepo({ [StorageKeys.AI_PROVIDER_PRIORITY_LIST]: [{ provider: 'gemini' }] });
    await loadGeneralSettings(repo as any);

    expect(loadSettingsSpy).toHaveBeenCalledTimes(1);
    expect(loadSettingsSpy.mock.calls[0][0]).toBe(panel);
    expect(loadTimingSpy).toHaveBeenCalled();
  });

  it('falls back to document.body when #panel-general missing', async () => {
    document.body.innerHTML = '<div>no panel</div>';
    const repo = makeRepo({});
    await loadGeneralSettings(repo as any);
    expect(loadSettingsSpy.mock.calls[0][0]).toBe(document.body);
    // prioritySlots default to [] -> selectedProviders all ''
    expect(visibilitySpy).toHaveBeenCalledWith(expect.any(Object), ['', '', '']);
    expect(layoutSpy).toHaveBeenCalledWith(['', '', '']);
  });

  it('applies prioritySlots and updates visibility/layout', async () => {
    const repo = makeRepo({
      [StorageKeys.AI_PROVIDER_PRIORITY_LIST]: [
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'ollama' },
      ],
    });
    await loadGeneralSettings(repo as any);
    // verify apply side effect via DOM: need elements to check, but we mocked visibility/layout so just check calls
    expect(visibilitySpy).toHaveBeenCalled();
    const args = visibilitySpy.mock.calls[0][1] as string[];
    expect(args).toEqual(['openai', 'ollama', '']);
    expect(layoutSpy).toHaveBeenCalledWith(['openai', 'ollama', '']);
  });

  it('handles undefined priority list -> defaults', async () => {
    const repo = makeRepo({});
    await loadGeneralSettings(repo as any);
    expect(visibilitySpy.mock.calls[0][1]).toEqual(['', '', '']);
  });

  it('syncs obsidian details open state when both elements present', async () => {
    const details = document.createElement('details');
    details.id = 'obsidianSettingsDetails';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = 'obsidianEnabled';
    checkbox.checked = true;
    document.body.appendChild(details);
    document.body.appendChild(checkbox);

    const repo = makeRepo({});
    await loadGeneralSettings(repo as any);
    expect(details.open).toBe(true);

    checkbox.checked = false;
    await loadGeneralSettings(repo as any);
    expect(details.open).toBe(false);
  });

  it('does not throw when obsidian details or checkbox missing', async () => {
    // only details
    const details = document.createElement('details');
    details.id = 'obsidianSettingsDetails';
    document.body.appendChild(details);
    await loadGeneralSettings(makeRepo({}) as any);
    // only checkbox
    document.body.innerHTML = '';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = 'obsidianEnabled';
    document.body.appendChild(checkbox);
    await expect(loadGeneralSettings(makeRepo({}) as any)).resolves.not.toThrow();
    // neither
    document.body.innerHTML = '';
    await expect(loadGeneralSettings(makeRepo({}) as any)).resolves.not.toThrow();
  });

  it('syncs localMarkdownExport visibility based on checkbox', async () => {
    const div = document.createElement('div');
    div.id = 'localMarkdownExportSettings';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = 'localMarkdownExportEnabled';
    document.body.appendChild(div);
    document.body.appendChild(cb);

    cb.checked = true;
    await loadGeneralSettings(makeRepo({}) as any);
    expect(div.classList.contains('hidden')).toBe(false);

    cb.checked = false;
    await loadGeneralSettings(makeRepo({}) as any);
    expect(div.classList.contains('hidden')).toBe(true);
  });

  it('handles missing localMarkdownExport elements', async () => {
    // missing div
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = 'localMarkdownExportEnabled';
    document.body.appendChild(cb);
    await expect(loadGeneralSettings(makeRepo({}) as any)).resolves.not.toThrow();

    // missing checkbox
    document.body.innerHTML = '';
    const div = document.createElement('div');
    div.id = 'localMarkdownExportSettings';
    document.body.appendChild(div);
    await expect(loadGeneralSettings(makeRepo({}) as any)).resolves.not.toThrow();
  });

  it('syncs reviewSummary manual actions visibility', async () => {
    const div = document.createElement('div');
    div.id = 'reviewSummaryManualActions';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = 'reviewSummaryEnabled';
    document.body.appendChild(div);
    document.body.appendChild(cb);

    cb.checked = true;
    await loadGeneralSettings(makeRepo({}) as any);
    expect(div.classList.contains('hidden')).toBe(false);

    cb.checked = false;
    await loadGeneralSettings(makeRepo({}) as any);
    expect(div.classList.contains('hidden')).toBe(true);

    // missing combinations
    document.body.innerHTML = '';
    document.body.appendChild(div);
    await expect(loadGeneralSettings(makeRepo({}) as any)).resolves.not.toThrow();
    document.body.innerHTML = '';
    document.body.appendChild(cb);
    await expect(loadGeneralSettings(makeRepo({}) as any)).resolves.not.toThrow();
  });

  it('shows provider info when type and baseUrl and divs present', async () => {
    const infoDiv = document.createElement('div');
    infoDiv.id = 'selectedProviderInfo';
    infoDiv.classList.add('hidden');
    const displayDiv = document.createElement('div');
    displayDiv.id = 'providerInfoDisplay';
    document.body.appendChild(infoDiv);
    document.body.appendChild(displayDiv);

    const repo = makeRepo({
      [StorageKeys.PROVIDER_TYPE]: 'openrouter',
      [StorageKeys.PROVIDER_BASE_URL]: 'https://api.openrouter.ai/',
    });
    await loadGeneralSettings(repo as any);
    expect(infoDiv.classList.contains('hidden')).toBe(false);
    expect(displayDiv.textContent).toBe('openrouter (https://api.openrouter.ai/)');
  });

  it('hides provider info when missing type or baseUrl', async () => {
    const infoDiv = document.createElement('div');
    infoDiv.id = 'selectedProviderInfo';
    infoDiv.classList.remove('hidden');
    document.body.appendChild(infoDiv);
    const displayDiv = document.createElement('div');
    displayDiv.id = 'providerInfoDisplay';
    document.body.appendChild(displayDiv);

    // missing baseUrl
    await loadGeneralSettings(makeRepo({ [StorageKeys.PROVIDER_TYPE]: 'openrouter' }) as any);
    expect(infoDiv.classList.contains('hidden')).toBe(true);

    // missing type
    infoDiv.classList.remove('hidden');
    await loadGeneralSettings(makeRepo({ [StorageKeys.PROVIDER_BASE_URL]: 'https://x' }) as any);
    expect(infoDiv.classList.contains('hidden')).toBe(true);

    // both missing
    infoDiv.classList.remove('hidden');
    await loadGeneralSettings(makeRepo({}) as any);
    expect(infoDiv.classList.contains('hidden')).toBe(true);
  });

  it('handles provider info divs missing partially', async () => {
    // only selectedProviderInfoDiv present, no displayDiv -> should still go to hidden branch
    const infoDiv = document.createElement('div');
    infoDiv.id = 'selectedProviderInfo';
    infoDiv.classList.remove('hidden');
    document.body.appendChild(infoDiv);
    // no displayDiv
    await loadGeneralSettings(
      makeRepo({
        [StorageKeys.PROVIDER_TYPE]: 'openrouter',
        [StorageKeys.PROVIDER_BASE_URL]: 'https://api.openrouter.ai/',
      }) as any,
    );
    // since providerInfoDisplayDiv missing, condition fails -> should add hidden
    expect(infoDiv.classList.contains('hidden')).toBe(true);

    // no selectedProviderInfoDiv at all -> no error
    document.body.innerHTML = '';
    const displayDiv = document.createElement('div');
    displayDiv.id = 'providerInfoDisplay';
    document.body.appendChild(displayDiv);
    await expect(
      loadGeneralSettings(
        makeRepo({
          [StorageKeys.PROVIDER_TYPE]: 'openrouter',
          [StorageKeys.PROVIDER_BASE_URL]: 'https://x',
        }) as any,
      ),
    ).resolves.not.toThrow();

    // neither div
    document.body.innerHTML = '';
    await expect(loadGeneralSettings(makeRepo({ [StorageKeys.PROVIDER_TYPE]: 'x', [StorageKeys.PROVIDER_BASE_URL]: 'y' }) as any)).resolves.not.toThrow();
  });

  it('else-if hidden branch when selectedProviderInfoDiv exists but condition false', async () => {
    const infoDiv = document.createElement('div');
    infoDiv.id = 'selectedProviderInfo';
    // initially not hidden
    document.body.appendChild(infoDiv);
    await loadGeneralSettings(makeRepo({}) as any);
    expect(infoDiv.classList.contains('hidden')).toBe(true);

    // when infoDiv missing, should not throw
    document.body.innerHTML = '';
    await expect(loadGeneralSettings(makeRepo({}) as any)).resolves.not.toThrow();
  });
});

describe('handlePurgeNow', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    // restore getMessage default implementation
    vi.mocked(i18n.getMessage).mockImplementation((key: string) => {
      const map: Record<string, string> = {
        purgeNowSkipped: 'skipped-msg',
        purgeNowSuccess_one: 'purged-one $COUNT$',
        purgeNowSuccess_other: 'purged-other $COUNT$',
        purgeNowSuccess: 'fallback-purge',
      };
      return (map as any)[key] ?? `msg:${key}`;
    });
  });

  it('early returns when button or status missing', async () => {
    document.body.innerHTML = '';
    await expect(handlePurgeNow()).resolves.toBeUndefined();
    document.body.innerHTML = '<button id="purgeNowBtn"></button>';
    await expect(handlePurgeNow()).resolves.toBeUndefined();
    document.body.innerHTML = '<span id="purgeNowStatus"></span>';
    await expect(handlePurgeNow()).resolves.toBeUndefined();
  });

  it('disables button and restores even on error thrown', async () => {
    document.body.innerHTML = '<button id="purgeNowBtn"></button><span id="purgeNowStatus"></span>';
    const btn = document.getElementById('purgeNowBtn') as HTMLButtonElement;
    const status = document.getElementById('purgeNowStatus')!;
    vi.mocked(sqliteService.purgeOldRecordsNow).mockRejectedValue(new Error('boom'));
    await expect(handlePurgeNow()).rejects.toThrow('boom');
    expect(btn.disabled).toBe(false);
    expect(status.textContent).toBe('');
  });

  it('shows service error with error string and fallback', async () => {
    document.body.innerHTML = '<button id="purgeNowBtn"></button><span id="purgeNowStatus"></span>';
    const status = document.getElementById('purgeNowStatus')!;
    vi.mocked(sqliteService.purgeOldRecordsNow).mockResolvedValue({ error: 'db error' } as any);
    await handlePurgeNow();
    expect(status.textContent).toBe('db error');

    vi.mocked(sqliteService.purgeOldRecordsNow).mockResolvedValue({ error: '' } as any);
    await handlePurgeNow();
    expect(status.textContent).toBe('Error');

    vi.mocked(sqliteService.purgeOldRecordsNow).mockResolvedValue({} as any); // error falsy but isServiceError true if we mock? need to force isServiceError
    // force isServiceError to return true even with undefined error
    const spy = vi.spyOn(sqliteService, 'isServiceError').mockReturnValue(true);
    vi.mocked(sqliteService.purgeOldRecordsNow).mockResolvedValue({ error: undefined } as any);
    await handlePurgeNow();
    expect(status.textContent).toBe('Error');
    spy.mockRestore();
  });

  it('shows skipped message with fallback when getMessage empty', async () => {
    document.body.innerHTML = '<button id="purgeNowBtn"></button><span id="purgeNowStatus"></span>';
    const status = document.getElementById('purgeNowStatus')!;
    vi.mocked(sqliteService.purgeOldRecordsNow).mockResolvedValue({ data: { purged: 0, skipped: true } } as any);
    vi.mocked(i18n.getMessage).mockReturnValueOnce(''); // for purgeNowSkipped
    await handlePurgeNow();
    expect(status.textContent).toBe('保持ポリシーが未設定のため、削除をスキップしました');

    // non-empty case
    vi.mocked(i18n.getMessage).mockReturnValue('skipped-msg');
    vi.mocked(sqliteService.purgeOldRecordsNow).mockResolvedValue({ data: { purged: 0, skipped: true } } as any);
    await handlePurgeNow();
    expect(status.textContent).toBe('skipped-msg');
  });

  it('shows success with plural key and fallback to count string', async () => {
    document.body.innerHTML = '<button id="purgeNowBtn"></button><span id="purgeNowStatus"></span>';
    const status = document.getElementById('purgeNowStatus')!;
    const pluralSpy = vi.mocked(i18nPlural.getPluralKey);
    // success with count 1
    vi.mocked(sqliteService.purgeOldRecordsNow).mockResolvedValue({ data: { purged: 5, skipped: false } } as any);
    vi.mocked(i18n.getMessage).mockImplementation((key: string) => {
      if (key.includes('purgeNowSuccess')) return `success-${key}`;
      return '';
    });
    await handlePurgeNow();
    expect(pluralSpy).toHaveBeenCalled();
    expect(status.textContent).toBe('success-purgeNowSuccess_other');

    // fallback empty -> use template
    vi.mocked(i18n.getMessage).mockReturnValue('');
    vi.mocked(sqliteService.purgeOldRecordsNow).mockResolvedValue({ data: { purged: 3, skipped: false } } as any);
    await handlePurgeNow();
    expect(status.textContent).toBe('3 件を削除しました');

    // purged 1 case to cover _one branch (in real getPluralKey locale en)
    vi.mocked(i18nPlural.getPluralKey).mockReturnValueOnce('purgeNowSuccess_one');
    vi.mocked(i18n.getMessage).mockReturnValueOnce('one-msg');
    vi.mocked(sqliteService.purgeOldRecordsNow).mockResolvedValue({ data: { purged: 1, skipped: false } } as any);
    await handlePurgeNow();
    expect(status.textContent).toBe('one-msg');
  });

  it('restores disabled after success', async () => {
    document.body.innerHTML = '<button id="purgeNowBtn"></button><span id="purgeNowStatus"></span>';
    const btn = document.getElementById('purgeNowBtn') as HTMLButtonElement;
    vi.mocked(sqliteService.purgeOldRecordsNow).mockResolvedValue({ data: { purged: 2, skipped: false } } as any);
    await handlePurgeNow();
    expect(btn.disabled).toBe(false);
    expect(btn.disabled).toBe(false);
  });

  it('clears status text initially', async () => {
    document.body.innerHTML = '<button id="purgeNowBtn"></button><span id="purgeNowStatus">old</span>';
    const status = document.getElementById('purgeNowStatus')!;
    status.textContent = 'old';
    vi.mocked(sqliteService.purgeOldRecordsNow).mockResolvedValue({ data: { purged: 1, skipped: false } } as any);
    vi.mocked(i18n.getMessage).mockReturnValue('new');
    await handlePurgeNow();
    expect(status.textContent).not.toBe('old');
  });
});

describe('handleContentPurgeNow', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    vi.mocked(i18n.getMessage).mockImplementation((key: string) => {
      const map: Record<string, string> = {
        contentPurgeNowSkipped: 'content-skipped-msg',
        contentPurgeNowSuccess_one: 'content-one $COUNT$',
        contentPurgeNowSuccess_other: 'content-other $COUNT$',
        contentPurgeNowSuccess: 'fallback-content',
      };
      return (map as any)[key] ?? `msg:${key}`;
    });
  });

  it('early returns when elements missing', async () => {
    document.body.innerHTML = '';
    await expect(handleContentPurgeNow()).resolves.toBeUndefined();
    document.body.innerHTML = '<button id="contentPurgeNowBtn"></button>';
    await expect(handleContentPurgeNow()).resolves.toBeUndefined();
    document.body.innerHTML = '<span id="contentPurgeNowStatus"></span>';
    await expect(handleContentPurgeNow()).resolves.toBeUndefined();
  });

  it('disables button and restores on throw', async () => {
    document.body.innerHTML = '<button id="contentPurgeNowBtn"></button><span id="contentPurgeNowStatus"></span>';
    const btn = document.getElementById('contentPurgeNowBtn') as HTMLButtonElement;
    const status = document.getElementById('contentPurgeNowStatus')!;
    vi.mocked(sqliteService.purgeContentNow).mockRejectedValue(new Error('boom'));
    await expect(handleContentPurgeNow()).rejects.toThrow('boom');
    expect(btn.disabled).toBe(false);
    expect(status.textContent).toBe('');
  });

  it('shows service error with fallback', async () => {
    document.body.innerHTML = '<button id="contentPurgeNowBtn"></button><span id="contentPurgeNowStatus"></span>';
    const status = document.getElementById('contentPurgeNowStatus')!;
    vi.mocked(sqliteService.purgeContentNow).mockResolvedValue({ error: 'err' } as any);
    await handleContentPurgeNow();
    expect(status.textContent).toBe('err');

    vi.mocked(sqliteService.purgeContentNow).mockResolvedValue({ error: '' } as any);
    await handleContentPurgeNow();
    expect(status.textContent).toBe('Error');

    const spy = vi.spyOn(sqliteService, 'isServiceError').mockReturnValue(true);
    vi.mocked(sqliteService.purgeContentNow).mockResolvedValue({ error: undefined } as any);
    await handleContentPurgeNow();
    expect(status.textContent).toBe('Error');
    spy.mockRestore();
  });

  it('shows skipped with fallback', async () => {
    document.body.innerHTML = '<button id="contentPurgeNowBtn"></button><span id="contentPurgeNowStatus"></span>';
    const status = document.getElementById('contentPurgeNowStatus')!;
    vi.mocked(sqliteService.purgeContentNow).mockResolvedValue({ data: { purged: 0, skipped: true } } as any);
    vi.mocked(i18n.getMessage).mockReturnValueOnce('');
    await handleContentPurgeNow();
    expect(status.textContent).toBe('コンテンツ保持ポリシーが未設定のため、削除をスキップしました');

    vi.mocked(i18n.getMessage).mockReturnValue('content-skipped-msg');
    vi.mocked(sqliteService.purgeContentNow).mockResolvedValue({ data: { purged: 0, skipped: true } } as any);
    await handleContentPurgeNow();
    expect(status.textContent).toBe('content-skipped-msg');
  });

  it('shows success with plural and fallback', async () => {
    document.body.innerHTML = '<button id="contentPurgeNowBtn"></button><span id="contentPurgeNowStatus"></span>';
    const status = document.getElementById('contentPurgeNowStatus')!;
    const pluralSpy = vi.mocked(i18nPlural.getPluralKey);
    vi.mocked(sqliteService.purgeContentNow).mockResolvedValue({ data: { purged: 7, skipped: false } } as any);
    vi.mocked(i18n.getMessage).mockImplementation((key: string) => `ok-${key}`);
    await handleContentPurgeNow();
    expect(pluralSpy).toHaveBeenCalled();
    expect(status.textContent).toContain('ok-');

    vi.mocked(i18n.getMessage).mockReturnValue('');
    vi.mocked(sqliteService.purgeContentNow).mockResolvedValue({ data: { purged: 4, skipped: false } } as any);
    await handleContentPurgeNow();
    expect(status.textContent).toBe('4 件の content を削除しました');

    vi.mocked(i18nPlural.getPluralKey).mockReturnValueOnce('contentPurgeNowSuccess_one');
    vi.mocked(i18n.getMessage).mockReturnValueOnce('one-content');
    vi.mocked(sqliteService.purgeContentNow).mockResolvedValue({ data: { purged: 1, skipped: false } } as any);
    await handleContentPurgeNow();
    expect(status.textContent).toBe('one-content');
  });

  it('clears status and restores disabled', async () => {
    document.body.innerHTML = '<button id="contentPurgeNowBtn"></button><span id="contentPurgeNowStatus">old</span>';
    const btn = document.getElementById('contentPurgeNowBtn') as HTMLButtonElement;
    const status = document.getElementById('contentPurgeNowStatus')!;
    vi.mocked(sqliteService.purgeContentNow).mockResolvedValue({ data: { purged: 2, skipped: false } } as any);
    vi.mocked(i18n.getMessage).mockReturnValue('new');
    await handleContentPurgeNow();
    expect(btn.disabled).toBe(false);
    expect(status.textContent).toBe('new');
  });
});
