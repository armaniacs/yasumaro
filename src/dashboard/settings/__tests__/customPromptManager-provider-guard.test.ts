/**
 * customPromptManager-provider-guard.test.ts
 * Task 4 Item 1: catalog-driven prompt-provider guard invariant.
 *
 * asPromptProvider must stay in step with PROVIDER_CATALOG: every catalog
 * entry with supportsCustomPrompt === true is either accepted by the guard
 * or named in DELIBERATELY_EXCLUDED below. A future provider that supports
 * custom prompts but is not wired into the CustomPrompt['provider'] union
 * fails this test loudly instead of drifting silently.
 */
import { describe, expect, it } from 'vitest';
import { asPromptProvider } from '../customPromptManager.js';
import { PROVIDER_CATALOG } from '../../../background/ai/providerCatalog.js';

/**
 * Catalog ids that support custom prompts per the catalog but are excluded
 * from the CustomPrompt['provider'] union on purpose. Currently exactly:
 * - 'built-in-ai': supports prompts per catalog but excluded from the
 *   CustomPrompt provider union. Admitting it as a prompt scope is a product
 *   decision, not a refactor task, so the guard keeps mapping it to 'all'.
 */
const DELIBERATELY_EXCLUDED: ReadonlySet<string> = new Set<string>(['built-in-ai']);

describe('asPromptProvider catalog invariant (Task 4 Item 1)', () => {
  it('accepts every supportsCustomPrompt catalog id except the deliberately-excluded set', () => {
    const promptCapable: string[] = [...PROVIDER_CATALOG]
      .filter(([, entry]) => entry.supportsCustomPrompt)
      .map(([id]) => id);
    expect(promptCapable.length).toBeGreaterThan(0);
    for (const id of promptCapable) {
      if (DELIBERATELY_EXCLUDED.has(id)) {
        expect(asPromptProvider(id)).toBe('all');
      } else {
        expect(asPromptProvider(id), `catalog id "${id}" supports custom prompts but the guard rejects it`).toBe(id);
      }
    }
    // The exclusion set itself must not go stale: every entry must still be
    // a supportsCustomPrompt catalog id that the guard maps to 'all'.
    expect([...DELIBERATELY_EXCLUDED].sort()).toEqual(['built-in-ai']);
    for (const id of DELIBERATELY_EXCLUDED) {
      expect(PROVIDER_CATALOG.get(id as 'built-in-ai')?.supportsCustomPrompt).toBe(true);
    }
  });

  it("maps 'openai-compatible' (supportsCustomPrompt false) to 'all'", () => {
    expect(PROVIDER_CATALOG.get('openai-compatible')?.supportsCustomPrompt).toBe(false);
    expect(asPromptProvider('openai-compatible')).toBe('all');
  });

  it("maps unknown and garbage inputs to 'all'", () => {
    expect(asPromptProvider('unrecognized-provider')).toBe('all');
    expect(asPromptProvider('')).toBe('all');
    expect(asPromptProvider(null)).toBe('all');
    expect(asPromptProvider(undefined)).toBe('all');
    expect(asPromptProvider(123)).toBe('all');
  });
});
