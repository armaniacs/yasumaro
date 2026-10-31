/**
 * panelCategories.test.ts (PBI 2026-10-31-08)
 * パネル分類の単一ソースを固定する:
 * - 分類の割り当て表がカタログのパネル全体を過不足なく覆う
 *   (未割り当てパネルは 'other' フォールバックに落ちる: BDD 境界値)
 * - 分類名の i18n キーが両 locale の messages.json に実在する
 * - 分類 UI の select の option 順と data-i18n-opt キーが定義と一致する
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PANEL_CATEGORY_ORDER,
  PANEL_CATEGORIES,
  PANEL_CATEGORY_FILTER_ALL,
  CATEGORY_PANEL_IDS,
  categoryForPanel,
} from '../panelCategories.js';
import { PANEL_CATALOG } from '../panelCatalog.js';

const html = readFileSync(
  resolve(process.cwd(), 'entrypoints/options/index.html'),
  'utf-8',
);
const enMessages = JSON.parse(
  readFileSync(resolve(process.cwd(), 'public/_locales/en/messages.json'), 'utf-8'),
) as Record<string, unknown>;
const jaMessages = JSON.parse(
  readFileSync(resolve(process.cwd(), 'public/_locales/ja/messages.json'), 'utf-8'),
) as Record<string, unknown>;

describe('panelCategories — 単一ソース', () => {
  it('falls back unassigned catalog panels to other (BDD 境界値: panel-diagnostics)', () => {
    // 分類の割り当て表に記載のないパネルは 'other' に落ちる。
    expect(categoryForPanel('panel-diagnostics')).toBe('other');
  });

  it('falls back unknown panel ids to other', () => {
    expect(categoryForPanel('panel-not-in-catalog')).toBe('other');
  });

  it('resolves each assigned panel to its declared category', () => {
    // ハッピーパスの代表: 記録設定・分析・出力の代表パネル。
    expect(categoryForPanel('panel-recording-conditions')).toBe('recording');
    expect(categoryForPanel('panel-tag-cluster')).toBe('analysis');
    expect(categoryForPanel('panel-export-import')).toBe('export');
    expect(categoryForPanel('panel-general')).toBe('setup');
  });

  it('covers every catalog panel exactly once (assigned or other fallback)', () => {
    const catalogIds = PANEL_CATALOG.map((e) => e.id);
    const assignedIds = Object.values(CATEGORY_PANEL_IDS).flat();
    // 割り当て表の全 id がカタログに実在する。
    for (const id of assignedIds) {
      expect(catalogIds, `${id} is not a catalog panel`).toContain(id);
    }
    // 割り当ての重複なし。
    expect(new Set(assignedIds).size).toBe(assignedIds.length);
    // 割り当て + フォールバックでカタログ全体を覆う。
    const fallbackIds = catalogIds.filter((id) => categoryForPanel(id) === 'other');
    expect(assignedIds.length + fallbackIds.length).toBe(catalogIds.length);
    for (const id of catalogIds) {
      expect(categoryForPanel(id)).toMatch(/^(setup|recording|ai|privacy|analysis|export|other)$/);
    }
  });

  it('pins the assigned panel set per category (順序・所属の断定)', () => {
    expect(CATEGORY_PANEL_IDS.setup).toEqual(['panel-general']);
    expect(CATEGORY_PANEL_IDS.recording).toEqual([
      'panel-domain',
      'panel-content',
      'panel-recording-conditions',
      'panel-tags',
    ]);
    expect(CATEGORY_PANEL_IDS.ai).toEqual(['panel-prompt', 'panel-ai-summary-cleansing']);
    expect(CATEGORY_PANEL_IDS.privacy).toEqual(['panel-privacy', 'panel-trust', 'panel-csp']);
    expect(CATEGORY_PANEL_IDS.export).toEqual([
      'panel-markdown-template',
      'panel-webhook-export',
      'panel-export-logs',
      'panel-export-import',
    ]);
  });

  it('pins ALL as the filter reset value', () => {
    expect(PANEL_CATEGORY_FILTER_ALL).toBe('all');
  });
});

describe('panelCategories — i18n (data-i18n / data-i18n-opt)', () => {
  it('resolves every category name key in both locales (BDD 境界値: en ロケール)', () => {
    for (const categoryId of PANEL_CATEGORY_ORDER) {
      const key = PANEL_CATEGORIES[categoryId].i18nKey;
      expect(enMessages, `${key} (${categoryId}) missing from en`).toHaveProperty(key);
      expect(jaMessages, `${key} (${categoryId}) missing from ja`).toHaveProperty(key);
      const enMessage = enMessages[key] as { message: string };
      const jaMessage = jaMessages[key] as { message: string };
      expect(enMessage.message.trim()).not.toBe('');
      expect(jaMessage.message.trim()).not.toBe('');
    }
  });

  it('pins the filter select option order and data-i18n-opt keys to the HTML', () => {
    const selectHtml = /<select id="panelCategoryFilter"[\s\S]*?<\/select>/.exec(html)?.[0] ?? '';
    expect(selectHtml).not.toBe('');

    const optionValues = [...selectHtml.matchAll(/<option value="([^"]+)" data-i18n-opt="([^"]+)"/g)];
    // 先頭 option は 'all' (フィルタ解除)、以降は分類の表示順。
    expect(optionValues.map((m) => m[1])).toEqual([PANEL_CATEGORY_FILTER_ALL, ...PANEL_CATEGORY_ORDER]);
    // data-i18n-opt キーが分類定義と一致する。
    for (const match of optionValues.slice(1)) {
      const categoryId = match[1] as keyof typeof PANEL_CATEGORIES;
      expect(match[2]).toBe(PANEL_CATEGORIES[categoryId].i18nKey);
    }
  });

  it('resolves the filter label key (data-i18n) in both locales', () => {
    const labelHtml = /<label[^>]*for="panelCategoryFilter"[^>]*>/.exec(html)?.[0] ?? '';
    expect(labelHtml).toContain('data-i18n="panelCategoryFilterLabel"');
    expect(enMessages).toHaveProperty('panelCategoryFilterLabel');
    expect(jaMessages).toHaveProperty('panelCategoryFilterLabel');
  });
});
