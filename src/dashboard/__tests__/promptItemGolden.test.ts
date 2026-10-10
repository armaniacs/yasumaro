// @vitest-environment jsdom
/**
 * promptItemGolden.test.ts
 * PBI NN19: .prompt-item 行 HTML の byte-identical golden pin.
 *
 * 4 つの行ビルダー (preset / default / list in customPromptManager,
 * template in markdownTemplateManager) が生成する HTML を、リファクタリング
 * 前に現在の出力で固定する。リファクタ後もこの golden が byte 同一で green で
 * あることが「生成 HTML の契約 (escapeHtml 位置・data-i18n・badge 条件・class)
 * が不変」であることの証明になる。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CustomPrompt } from '../../utils/types.js';
import type { Settings } from '../../utils/storage/types.js';

if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
}

vi.mock('../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    settingsRepository: {
      getAll: vi.fn().mockResolvedValue({}),
      getMany: vi.fn().mockResolvedValue({}),
      get: vi.fn(),
      set: vi.fn().mockResolvedValue(undefined),
      setAll: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.mock('../../utils/ui/confirmDialog.js', () => ({
  showConfirmDialog: vi.fn().mockResolvedValue(true),
  showAlertDialog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/ui/settingsUiHelper.js', () => ({ showStatus: vi.fn() }));

vi.mock('../../utils/i18n-dom.js', () => ({ applyI18n: vi.fn() }));

vi.mock('../../utils/i18n.js', async () => {
  const { mockGetMessage } = await import('../../../testDir/i18nMock.js');
  const getMessage = vi.fn((key: string) => {
    const messages: Record<string, string | undefined> = {
      promptProviderAll: 'All Providers',
      defaultPrompt: 'Default',
      activePrompt: 'Active',
    };
    return key in messages ? messages[key] : key;
  });
  return { ...mockGetMessage(getMessage), getUserLocale: vi.fn(() => 'en'), isRTL: vi.fn(() => false) };
});

vi.mock('../../utils/customPromptUtils.js', () => ({
  createPrompt: vi.fn(),
  updatePrompt: vi.fn(),
  deletePrompt: vi.fn(),
  setActivePrompt: vi.fn(),
  validatePrompt: vi.fn(() => ({ valid: true })),
  DEFAULT_USER_PROMPT: 'Default user prompt',
  DEFAULT_SYSTEM_PROMPT: 'Default system prompt',
  PRESET_PROMPTS: [
    { id: 'default', name: 'Default', nameJa: 'デフォルト', userPrompt: 'Default prompt', systemPrompt: '' },
    { id: 'concise', name: 'Concise', nameJa: '簡潔', userPrompt: 'Be concise', systemPrompt: '' },
  ],
  getPresetPrompt: vi.fn((id: string) => ({
    default: { id: 'default', name: 'Default', nameJa: 'デフォルト', userPrompt: 'Default prompt', systemPrompt: '' },
    concise: { id: 'concise', name: 'Concise', nameJa: '簡潔', userPrompt: 'Be concise', systemPrompt: '' },
  }[id])),
  getPromptDisplayName: vi.fn((preset: { name: string; nameJa: string }, locale: string) =>
    locale === 'ja' ? preset.nameJa : preset.name),
}));

import { createCustomPromptManager } from '../settings/customPromptManager.js';
import { buildPromptItemRow, getUiLocale } from '../settings/customPromptManager.js';
import { createMarkdownTemplateManager } from '../markdownTemplateManager.js';
import { StorageKeys } from '../../utils/storage/types.js';

const asSettings = (s: { custom_prompts: CustomPrompt[] }): Settings =>
  s as unknown as Settings;

const asTplSettings = (templates: unknown[], activeId: string): Settings =>
  ({ [StorageKeys.MARKDOWN_EXPORT_TEMPLATES]: templates, [StorageKeys.ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID]: activeId }) as unknown as Settings;

function cp(id: string, name: string, provider: CustomPrompt['provider'], isActive: boolean): CustomPrompt {
  return { id, name, provider, systemPrompt: '', prompt: 'x', isActive, createdAt: 1, updatedAt: 1 };
}

function tpl(id: string): {
  id: string; name: string; fileTemplate: string; entryTemplate: string; isDefault: boolean; createdAt: number; updatedAt: number;
} {
  return { id, name: 'My Template', fileTemplate: '# {{entries}}', entryTemplate: '- {{title}}', isDefault: false, createdAt: 1, updatedAt: 1 };
}

function promptDom(): void {
  document.body.innerHTML = `
    <div id="promptList"></div>
    <div id="noPromptsMessage"></div>
    <input id="promptName" />
    <select id="promptProvider"><option value="all">All</option><option value="gemini">Gemini</option></select>
    <input id="promptSystem" />
    <textarea id="promptText"></textarea>
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

/** Golden 値: リファクタリング前の render 出力を byte 単位で固定したもの。 */
const GOLDEN = {
  A: `<div class="prompt-item " data-prompt-id="__preset__concise">
            <div class="prompt-item-header">
                <span class="prompt-name">Concise</span>
                <span class="prompt-provider">(All Providers)</span>
                
            </div>
            <div class="prompt-item-actions">
                <button id="activate-prompt-__preset__concise" class="btn-sm btn-activate" data-i18n="activate">有効化</button>
                <button id="duplicate-prompt-__preset__concise" class="btn-sm btn-duplicate" data-i18n="duplicate">複製</button>
            </div>
        </div>
    
        <div class="prompt-item active" data-prompt-id="__default__">
            <div class="prompt-item-header">
                <span class="prompt-name">Default</span>
                <span class="prompt-provider">(All Providers)</span>
                <span class="badge badge-active" data-i18n="activePrompt">Active</span>
            </div>
            <div class="prompt-item-actions">
                
                <button id="duplicate-prompt-__default__" class="btn-sm btn-duplicate" data-i18n="duplicate">複製</button>
            </div>
        </div>
    `,
  B: `<div class="prompt-item active" data-prompt-id="__preset__concise">
            <div class="prompt-item-header">
                <span class="prompt-name">Concise</span>
                <span class="prompt-provider">(All Providers)</span>
                <span class="badge badge-active" data-i18n="activePrompt">有効</span>
            </div>
            <div class="prompt-item-actions">
                
                <button id="duplicate-prompt-__preset__concise" class="btn-sm btn-duplicate" data-i18n="duplicate">複製</button>
            </div>
        </div>
    
        <div class="prompt-item " data-prompt-id="__default__">
            <div class="prompt-item-header">
                <span class="prompt-name">Default</span>
                <span class="prompt-provider">(All Providers)</span>
                
            </div>
            <div class="prompt-item-actions">
                <button id="activate-prompt-__default__" class="btn-sm btn-activate" data-i18n="activate">有効化</button>
                <button id="duplicate-prompt-__default__" class="btn-sm btn-duplicate" data-i18n="duplicate">複製</button>
            </div>
        </div>
    `,
  C: `<div class="prompt-item " data-prompt-id="__preset__concise">
            <div class="prompt-item-header">
                <span class="prompt-name">Concise</span>
                <span class="prompt-provider">(All Providers)</span>
                
            </div>
            <div class="prompt-item-actions">
                <button id="activate-prompt-__preset__concise" class="btn-sm btn-activate" data-i18n="activate">有効化</button>
                <button id="duplicate-prompt-__preset__concise" class="btn-sm btn-duplicate" data-i18n="duplicate">複製</button>
            </div>
        </div>
    
        <div class="prompt-item active" data-prompt-id="__default__">
            <div class="prompt-item-header">
                <span class="prompt-name">Default</span>
                <span class="prompt-provider">(All Providers)</span>
                <span class="badge badge-active" data-i18n="activePrompt">Active</span>
            </div>
            <div class="prompt-item-actions">
                
                <button id="duplicate-prompt-__default__" class="btn-sm btn-duplicate" data-i18n="duplicate">複製</button>
            </div>
        </div>
    
        <div class="prompt-item " data-prompt-id="p1">
            <div class="prompt-item-header">
                <span class="prompt-name">Test Prompt</span>
                <span class="prompt-provider">(All Providers)</span>
                
            </div>
            <div class="prompt-item-actions">
                <button id="activate-prompt-p1" class="btn-sm btn-activate" data-i18n="activate">有効化</button>
                <button id="duplicate-prompt-p1" class="btn-sm btn-duplicate" data-i18n="duplicate">複製</button>
                <button id="edit-prompt-p1" class="btn-sm btn-edit" data-i18n="edit">編集</button>
                <button id="delete-prompt-p1" class="btn-sm btn-delete" data-i18n="delete">削除</button>
            </div>
        </div>
    `,
  D: `<div class="prompt-item " data-prompt-id="__preset__concise">
            <div class="prompt-item-header">
                <span class="prompt-name">Concise</span>
                <span class="prompt-provider">(All Providers)</span>
                
            </div>
            <div class="prompt-item-actions">
                <button id="activate-prompt-__preset__concise" class="btn-sm btn-activate" data-i18n="activate">有効化</button>
                <button id="duplicate-prompt-__preset__concise" class="btn-sm btn-duplicate" data-i18n="duplicate">複製</button>
            </div>
        </div>
    
        <div class="prompt-item " data-prompt-id="__default__">
            <div class="prompt-item-header">
                <span class="prompt-name">Default</span>
                <span class="prompt-provider">(All Providers)</span>
                
            </div>
            <div class="prompt-item-actions">
                <button id="activate-prompt-__default__" class="btn-sm btn-activate" data-i18n="activate">有効化</button>
                <button id="duplicate-prompt-__default__" class="btn-sm btn-duplicate" data-i18n="duplicate">複製</button>
            </div>
        </div>
    
        <div class="prompt-item active" data-prompt-id="p2">
            <div class="prompt-item-header">
                <span class="prompt-name">Active Prompt</span>
                <span class="prompt-provider">(googleGemini)</span>
                <span class="badge badge-active" data-i18n="activePrompt">Active</span>
            </div>
            <div class="prompt-item-actions">
                
                <button id="duplicate-prompt-p2" class="btn-sm btn-duplicate" data-i18n="duplicate">複製</button>
                <button id="edit-prompt-p2" class="btn-sm btn-edit" data-i18n="edit">編集</button>
                <button id="delete-prompt-p2" class="btn-sm btn-delete" data-i18n="delete">削除</button>
            </div>
        </div>
    `,
  E: `<div class="prompt-item active" data-template-id="default">
      <div class="prompt-item-header">
        <span class="prompt-name">markdownTemplateDefaultName</span>
        <span class="badge badge-active" data-i18n="markdownTemplateActiveLabel">Active</span>
      </div>
      <div class="prompt-item-actions">
        
        <button id="markdown-template-duplicate-default" class="btn-sm btn-duplicate" data-i18n="duplicate">Duplicate</button>
        
      </div>
    </div>
  
    <div class="prompt-item " data-template-id="tpl1">
      <div class="prompt-item-header">
        <span class="prompt-name">My Template</span>
        
      </div>
      <div class="prompt-item-actions">
        <button id="markdown-template-activate-tpl1" class="btn-sm btn-activate" data-i18n="activate">Activate</button>
        <button id="markdown-template-duplicate-tpl1" class="btn-sm btn-duplicate" data-i18n="duplicate">Duplicate</button>
        
      <button id="markdown-template-edit-tpl1" class="btn-sm btn-edit" data-i18n="edit">Edit</button>
      <button id="markdown-template-delete-tpl1" class="btn-sm btn-delete" data-i18n="delete">Delete</button>
    
      </div>
    </div>
  `,
  F: `<div class="prompt-item " data-template-id="default">
      <div class="prompt-item-header">
        <span class="prompt-name">markdownTemplateDefaultName</span>
        
      </div>
      <div class="prompt-item-actions">
        <button id="markdown-template-activate-default" class="btn-sm btn-activate" data-i18n="activate">Activate</button>
        <button id="markdown-template-duplicate-default" class="btn-sm btn-duplicate" data-i18n="duplicate">Duplicate</button>
        
      </div>
    </div>
  
    <div class="prompt-item active" data-template-id="tpl1">
      <div class="prompt-item-header">
        <span class="prompt-name">My Template</span>
        <span class="badge badge-active" data-i18n="markdownTemplateActiveLabel">Active</span>
      </div>
      <div class="prompt-item-actions">
        
        <button id="markdown-template-duplicate-tpl1" class="btn-sm btn-duplicate" data-i18n="duplicate">Duplicate</button>
        
      <button id="markdown-template-edit-tpl1" class="btn-sm btn-edit" data-i18n="edit">Edit</button>
      <button id="markdown-template-delete-tpl1" class="btn-sm btn-delete" data-i18n="delete">Delete</button>
    
      </div>
    </div>
  `,
};

describe('prompt-item row HTML golden', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('preset + default rows (no custom prompts)', () => {
    promptDom();
    createCustomPromptManager().init(asSettings({ custom_prompts: [] }));
    const html = document.getElementById('promptList')!.innerHTML;
    expect(html).toBe(GOLDEN.A);
  });

  it('active preset row (badge with 有効) + inactive default', () => {
    promptDom();
    createCustomPromptManager().init(asSettings({ custom_prompts: [cp('__preset__concise', 'Concise', 'all', true)] }));
    const html = document.getElementById('promptList')!.innerHTML;
    expect(html).toBe(GOLDEN.B);
  });

  it('inactive custom list row with edit/delete', () => {
    promptDom();
    createCustomPromptManager().init(asSettings({ custom_prompts: [cp('p1', 'Test Prompt', 'all', false)] }));
    const html = document.getElementById('promptList')!.innerHTML;
    expect(html).toBe(GOLDEN.C);
  });

  it('active custom list row with provider label', () => {
    promptDom();
    createCustomPromptManager().init(asSettings({ custom_prompts: [cp('p2', 'Active Prompt', 'gemini', true)] }));
    const html = document.getElementById('promptList')!.innerHTML;
    expect(html).toBe(GOLDEN.D);
  });

  it('template rows: active default + inactive custom', () => {
    templateDom();
    createMarkdownTemplateManager().init(asTplSettings([tpl('tpl1')], 'default'));
    const html = document.getElementById('markdownTemplateList')!.innerHTML;
    expect(html).toBe(GOLDEN.E);
  });

  it('template rows: inactive default + active custom', () => {
    templateDom();
    createMarkdownTemplateManager().init(asTplSettings([tpl('tpl1')], 'tpl1'));
    const html = document.getElementById('markdownTemplateList')!.innerHTML;
    expect(html).toBe(GOLDEN.F);
  });
});

describe('single prompt-item row builder (PBI NN19)', () => {
  const promptLabels = { activate: '有効化', duplicate: '複製', edit: '編集', delete: '削除' };
  const baseRows = {
    indentUnit: 4,
    idAttribute: 'data-prompt-id',
    buttonIdPrefix: '',
    buttonIdSuffix: '-prompt',
    providerLabel: 'All Providers',
    labels: promptLabels,
  };

  it('preset row: buildPromptItemRow reproduces the pinned preset bytes', () => {
    const nextRow = '</div>\n    \n        <div class="prompt-item active" data-prompt-id="__default__"';
    const segment = GOLDEN.A.slice(0, GOLDEN.A.indexOf(nextRow) + '</div>'.length);
    const raw = buildPromptItemRow({
      ...baseRows,
      id: '__preset__concise',
      displayName: 'Concise',
      isActive: false,
      badgeI18nKey: 'activePrompt',
      badgeText: '有効',
      showEditDelete: false,
    });
    expect(raw).toBe(`\n        ${segment}\n    `);
  });

  it('default row: buildPromptItemRow reproduces the pinned default bytes', () => {
    const segment = GOLDEN.A.slice(GOLDEN.A.indexOf('<div class="prompt-item active" data-prompt-id="__default__"'));
    const raw = buildPromptItemRow({
      ...baseRows,
      id: '__default__',
      displayName: 'Default',
      isActive: true,
      badgeI18nKey: 'activePrompt',
      badgeText: 'Active',
      showEditDelete: false,
    });
    expect(raw).toBe(`\n        ${segment}`);
  });

  it('list row: buildPromptItemRow reproduces the pinned list bytes', () => {
    const segment = GOLDEN.C.slice(GOLDEN.C.indexOf('<div class="prompt-item " data-prompt-id="p1"'));
    const raw = buildPromptItemRow({
      ...baseRows,
      id: 'p1',
      displayName: 'Test Prompt',
      isActive: false,
      badgeI18nKey: 'activePrompt',
      badgeText: 'Active',
      showEditDelete: true,
      editDeleteLevel: 4,
    });
    expect(raw).toBe(`\n        ${segment}`);
  });

  it('template row: buildPromptItemRow reproduces the pinned template bytes', () => {
    const segment = GOLDEN.E.slice(GOLDEN.E.indexOf('<div class="prompt-item " data-template-id="tpl1"'));
    const raw = buildPromptItemRow({
      indentUnit: 2,
      idAttribute: 'data-template-id',
      buttonIdPrefix: 'markdown-template-',
      buttonIdSuffix: '',
      id: 'tpl1',
      displayName: 'My Template',
      isActive: false,
      badgeI18nKey: 'markdownTemplateActiveLabel',
      badgeText: 'Active',
      labels: { activate: 'Activate', duplicate: 'Duplicate', edit: 'Edit', delete: 'Delete' },
      showEditDelete: true,
      editDeleteLevel: 3,
      editDeleteBlankBeforeLevel: 4,
      actionsBlankAfterLevel: 2,
    });
    expect(raw).toBe(`\n    ${segment}`);
  });

  it('locale detection is consolidated in getUiLocale', () => {
    vi.stubGlobal('navigator', { language: 'ja-JP' });
    expect(getUiLocale()).toBe('ja');
    vi.stubGlobal('navigator', { language: 'en-US' });
    expect(getUiLocale()).toBe('en');
    vi.unstubAllGlobals();
  });

  it('no duplicate startsWith("ja") locale expressions remain in customPromptManager.ts', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/dashboard/settings/customPromptManager.ts'), 'utf8');
    const matches = source.match(/navigator\.language\.startsWith\('ja'\)/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});
