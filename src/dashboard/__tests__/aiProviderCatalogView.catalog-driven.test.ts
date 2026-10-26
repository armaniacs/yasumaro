/**
 * @vitest-environment jsdom
 * aiProviderCatalogView.catalog-driven.test.ts (PBI 2026-09-21-14)
 * Proves the views render provider variants from PROVIDER_VIEW_METADATA
 * alone: a fixture row with custom view metadata renders accordingly with no
 * view change, and every catalog id keeps the legacy rendering (equivalence
 * with the pre-migration entry-field behavior).
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  PROVIDER_CATALOG,
  PROVIDER_VIEW_METADATA,
  type ProviderCatalogEntry,
  type ProviderViewMetadata,
} from '../../background/ai/providerCatalog.js';
import type { ProviderId } from '../../utils/storage/types.js';
import { renderProviderSettings } from '../aiProviderCatalogView.js';
import { createBProviderAccordionView } from '../aiProviderB/providerAccordionView.js';

const FIXTURE_ID = '__catalog_fixture__' as ProviderId;

// The registries export ReadonlyMap so production callers cannot mutate them,
// but this test has to register a fixture row at runtime. Both hold plain
// Maps, so the downcast describes the seam honestly instead of repeating a
// per-call assertion the values cannot satisfy.
const mutableCatalog = PROVIDER_CATALOG as Map<ProviderId, ProviderCatalogEntry>;
const mutableViewMetadata = PROVIDER_VIEW_METADATA as Map<ProviderId, ProviderViewMetadata>;

const FIXTURE_ENTRY: ProviderCatalogEntry = {
  baseUrlKey: 'fixture_base_url',
  apiKeyKey: 'fixture_api_key',
  modelKey: 'fixture_model',
  requiresApiKey: true,
  isLocal: false,
  label: 'Fixture',
  labelI18nKey: 'openaiCompatible',
  supportsCustomPrompt: false,
  settingsBlockKind: 'generic',
  apiKeyLabelI18nKey: 'aiApiKey',
};

// View-only data for the fixture lives where it belongs after the migration:
// PROVIDER_VIEW_METADATA (mirrors the PROVIDER_CATALOG.set test-seam poke).
const FIXTURE_VIEW_META: ProviderViewMetadata = {
  cssClass: 'fixture-settings',
  defaultOpen: true,
  extraFields: [
    {
      storageKey: 'fixture_extra',
      inputId: 'fixtureExtra',
      type: 'text',
      labelI18nKey: 'modelName',
      a11y: {
        describedBy: 'fixtureNote fixtureError',
        noteId: 'fixtureNote',
        noteI18nKey: 'modelName',
        errorId: 'fixtureError',
      },
    },
  ],
};

describe('catalog-driven provider UI', () => {
  afterEach(() => {
    mutableCatalog.delete(FIXTURE_ID);
    mutableViewMetadata.delete(FIXTURE_ID);
    document.body.innerHTML = '';
  });

  it('gemini view values moved verbatim to PROVIDER_VIEW_METADATA', () => {
    const meta = PROVIDER_VIEW_METADATA.get('gemini');
    expect(meta?.cssClass).toBe('');
    expect(meta?.defaultOpen).toBe(true);
    expect(meta?.extraFields?.[0]?.a11y).toEqual({
      describedBy: 'geminiApiVersionNote geminiApiVersionError',
      noteId: 'geminiApiVersionNote',
      noteI18nKey: 'note_gemini_api_version',
      errorId: 'geminiApiVersionError',
    });
    // The entry itself no longer carries view fields.
    expect(Object.prototype.hasOwnProperty.call(PROVIDER_CATALOG.get('gemini'), 'cssClass')).toBe(false);
  });

  it('other ids resolve empty view metadata while OpenAI has endpoint help', () => {
    for (const [id, meta] of PROVIDER_VIEW_METADATA) {
      if (id === 'gemini' || id === 'openai-official') continue;
      expect(Object.keys(meta), `${id}`).toEqual([]);
    }
    expect(PROVIDER_VIEW_METADATA.get('openai-official')).toEqual({ helpI18nKey: 'openaiOfficialHelp' });
    expect(PROVIDER_CATALOG.get('openai' as ProviderId)?.apiKeyLabelI18nKey).toBeUndefined();
  });

  it('a fixture row with view metadata renders css class, a11y block, and open state from the map alone', () => {
    mutableCatalog.set(FIXTURE_ID, FIXTURE_ENTRY);
    mutableViewMetadata.set(FIXTURE_ID, FIXTURE_VIEW_META);

    const c = document.createElement('div');
    document.body.appendChild(c);
    renderProviderSettings(c, FIXTURE_ID);
    expect(c.id).toBe(`${FIXTURE_ID}Settings`);
    expect(c.classList.contains('fixture-settings')).toBe(true);
    const apiKeyLabel = [...c.querySelectorAll('label')].find(
      (l) => l.htmlFor === 'fixtureApiKey',
    );
    expect(apiKeyLabel?.getAttribute('data-i18n')).toBe('aiApiKey');
    const extra = c.querySelector('#fixtureExtra');
    expect(extra?.getAttribute('aria-describedby')).toBe('fixtureNote fixtureError');
    expect(c.querySelector('#fixtureNote')).not.toBeNull();
    expect(c.querySelector('#fixtureError')?.getAttribute('role')).toBe('alert');

    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = createBProviderAccordionView(container);
    const fixtureDetails = container.querySelector(
      `details[data-provider="${FIXTURE_ID}Settings"]`,
    ) as HTMLDetailsElement;
    expect(fixtureDetails.open).toBe(true);
    view.destroy();
    c.remove();
    container.remove();
  });

  it('default resolution matches legacy behavior (class present, aiApiKey, closed)', () => {
    mutableCatalog.set(FIXTURE_ID, FIXTURE_ENTRY);
    const c = document.createElement('div');
    document.body.appendChild(c);
    renderProviderSettings(c, FIXTURE_ID);
    expect(c.classList.contains('openai-settings')).toBe(true);
    const apiKeyLabel = [...c.querySelectorAll('label')].find((l) => l.htmlFor === 'fixtureApiKey');
    expect(apiKeyLabel?.getAttribute('data-i18n')).toBe('aiApiKey');
    expect(c.querySelector('[aria-describedby]')).toBeNull();
    c.remove();
  });

  it('METADATA-driven rendering is equivalent to the legacy entry-field behavior for every id', () => {
    for (const [id, meta] of PROVIDER_VIEW_METADATA) {
      const c = document.createElement('div');
      document.body.appendChild(c);
      renderProviderSettings(c, id);
      // cssClass: '' opts out (gemini), undefined falls back to 'openai-settings'.
      expect(c.classList.contains('openai-settings'), `${id}`).toBe(meta.cssClass === undefined);
      if (meta.cssClass !== undefined && meta.cssClass !== '') {
        expect(c.classList.contains(meta.cssClass), `${id}`).toBe(true);
      }
      for (const field of meta.extraFields ?? []) {
        expect(c.querySelector(`#${field.inputId}`), `${id}:${field.inputId}`).not.toBeNull();
      }
      c.remove();
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = createBProviderAccordionView(container);
    for (const [id, meta] of PROVIDER_VIEW_METADATA) {
      const details = container.querySelector(
        `details[data-provider="${id}Settings"]`,
      ) as HTMLDetailsElement;
      expect(details.open, `${id}`).toBe(meta.defaultOpen === true);
    }
    view.destroy();
    container.remove();
  });
});
