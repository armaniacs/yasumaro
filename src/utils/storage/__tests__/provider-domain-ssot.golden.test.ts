/**
 * provider-domain-ssot.golden.test.ts (PBI 2026-09-21-13)
 * Golden pins of the CURRENT hand-listed domain arrays, copied verbatim from
 * source before derivation. These stay green before AND after the refactor:
 * any drift in membership or order fails here.
 *
 * Common-mode notice (Checking Team 2026-09-22, Blue Team Medium): manifest
 * host_permissions AND the CSP default set both derive from
 * PROVIDER_ALLOWLIST_ROWS, so one bad row can open two egress layers at
 * once. Editing any `permissionTier` / `domain` value therefore REQUIRES
 * regenerating these goldens in the same PR, and new provider rows belong
 * in the security-review checklist (egress surface = host_permissions).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CSPValidator } from '../../cspValidator.js';
import {
  AI_PROVIDER_HOST_PERMISSIONS,
  OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS,
} from '../../cspDomains.js';
import { ALLOWED_AI_PROVIDER_DOMAINS } from '../urlWhitelist.js';
import { ALL_LIST_SOURCES } from '../../listSources.js';

/** Verbatim copy of cspValidator.ts DEFAULT_ALLOWED_DOMAINS (13 entries). */
export const GOLDEN_DEFAULT_ALLOWED_DOMAINS = [
  'generativelanguage.googleapis.com',
  'api.openai.com',
  'api.anthropic.com',
  'api.groq.com',
  'mistral.ai',
  'api.mistral.ai',
  'deepseek.com',
  'api.deepseek.com',
  'voyageai.com',
  'volcengine.com',
  'z.ai',
  'wandb.ai',
  'api.ai.sakura.ad.jp',
];

/** Verbatim copy of cspValidator.ts PROVIDER_TO_DOMAIN (30 entries, in order). */
export const GOLDEN_PROVIDER_TO_DOMAIN: ReadonlyArray<readonly [string, string]> = [
  ['huggingface', 'api-inference.huggingface.co'],
  ['openrouter', 'api.openrouter.ai'],
  ['perplexity', 'perplexity.ai'],
  ['jina', 'jina.ai'],
  ['deepinfra', 'deepinfra.com'],
  ['cerebras', 'cerebras.ai'],
  ['venice', 'api.venice.ai'],
  ['scaleway', 'api.scaleway.ai'],
  ['nano-gpt', 'nano-gpt.com'],
  ['poe', 'api.poe.com'],
  ['chutes', 'llm.chutes.ai'],
  ['sarvam', 'api.sarvam.ai'],
  ['nebius', 'nebius.com'],
  ['sambanova', 'sambanova.ai'],
  ['nscale', 'nscale.com'],
  ['featherless', 'featherless.ai'],
  ['galadriel', 'galadriel.com'],
  ['recraft', 'recraft.ai'],
  ['volcengine', 'volcengine.com'],
  ['z-ai', 'z.ai'],
  ['wandb', 'wandb.ai'],
  ['helicone', 'ai-gateway.helicone.ai'],
  ['publicai', 'api.publicai.co'],
  ['synthetic', 'api.synthetic.new'],
  ['stima', 'api.stima.tech'],
  ['abliteration', 'api.abliteration.ai'],
  ['llamagate', 'api.llamagate.dev'],
  ['gmi', 'api.gmi-serving.com'],
  ['xiaomimimo', 'xiaomimimo.com'],
  ['sakura', 'api.ai.sakura.ad.jp'],
];

/** Verbatim copy of cspDomains.ts AI_PROVIDER_HOST_PERMISSIONS (14 entries). */
export const GOLDEN_REQUIRED_PERMISSIONS = [
  'https://generativelanguage.googleapis.com/*',
  'https://api.openai.com/*',
  'https://*.openai.com/*',
  'https://api.anthropic.com/*',
  'https://api.groq.com/*',
  'https://mistral.ai/*',
  'https://api.mistral.ai/*',
  'https://deepseek.com/*',
  'https://api.deepseek.com/*',
  'https://voyageai.com/*',
  'https://volcengine.com/*',
  'https://z.ai/*',
  'https://wandb.ai/*',
  'https://api.ai.sakura.ad.jp/*',
];

/** Verbatim copy of the hardcoded head of OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS (26 entries). */
export const GOLDEN_OPTIONAL_PERMISSIONS_HEAD = [
  'https://api-inference.huggingface.co/*',
  'https://api.openrouter.ai/*',
  'https://deepinfra.com/*',
  'https://cerebras.ai/*',
  'https://ai-gateway.helicone.ai/*',
  'https://api.publicai.co/*',
  'https://api.venice.ai/*',
  'https://api.scaleway.ai/*',
  'https://api.synthetic.new/*',
  'https://api.stima.tech/*',
  'https://nano-gpt.com/*',
  'https://api.poe.com/*',
  'https://llm.chutes.ai/*',
  'https://api.abliteration.ai/*',
  'https://api.llamagate.dev/*',
  'https://api.gmi-serving.com/*',
  'https://api.sarvam.ai/*',
  'https://xiaomimimo.com/*',
  'https://nebius.com/*',
  'https://sambanova.ai/*',
  'https://nscale.com/*',
  'https://featherless.ai/*',
  'https://galadriel.com/*',
  'https://recraft.ai/*',
  'https://perplexity.ai/*',
  'https://jina.ai/*',
];

/** Verbatim copy of the hardcoded head of ALLOWED_AI_PROVIDER_DOMAINS (38 entries). */
export const GOLDEN_WHITELIST_HEAD = [
  'generativelanguage.googleapis.com',
  'api.groq.com',
  'api.openai.com',
  'api.anthropic.com',
  'api-inference.huggingface.co',
  'openrouter.ai',
  'api.openrouter.ai',
  'mistral.ai',
  'deepinfra.com',
  'cerebras.ai',
  'ai-gateway.helicone.ai',
  'api.publicai.co',
  'api.venice.ai',
  'api.scaleway.ai',
  'api.synthetic.new',
  'api.stima.tech',
  'nano-gpt.com',
  'api.poe.com',
  'llm.chutes.ai',
  'api.abliteration.ai',
  'api.llamagate.dev',
  'api.gmi-serving.com',
  'api.sarvam.ai',
  'deepseek.com',
  'xiaomimimo.com',
  'nebius.com',
  'sambanova.ai',
  'nscale.com',
  'featherless.ai',
  'galadriel.com',
  'perplexity.ai',
  'recraft.ai',
  'jina.ai',
  'voyageai.com',
  'volcengine.com',
  'z.ai',
  'wandb.ai',
  'api.ai.sakura.ad.jp',
];

describe('provider domain goldens (PBI 2026-09-21-13)', () => {
  beforeEach(() => {
    CSPValidator.reset();
  });

  it('DEFAULT_ALLOWED_DOMAINS behavior is exactly the 13 golden domains in order', () => {
    expect(CSPValidator.getAllowedDomains()).toEqual(GOLDEN_DEFAULT_ALLOWED_DOMAINS);
    for (const domain of GOLDEN_DEFAULT_ALLOWED_DOMAINS) {
      expect(CSPValidator.isUrlAllowed(`https://${domain}/v1/x`)).toBe(true);
    }
  });

  it('PROVIDER_TO_DOMAIN exposes exactly the 30 golden ids with exact values', () => {
    // Set-identical to the legacy literal; the legacy interleaved key order
    // (volcengine/z-ai/wandb mid-list, sakura last) is a documented delta —
    // derivation emits required rows before optional rows. Order is cosmetic:
    // the dashboard sorts the list and lookups are key-based.
    expect(new Set(CSPValidator.getAvailableProviders())).toEqual(
      new Set(GOLDEN_PROVIDER_TO_DOMAIN.map(([id]) => id)),
    );
    expect(CSPValidator.getAvailableProviders()).toHaveLength(GOLDEN_PROVIDER_TO_DOMAIN.length);
    for (const [id, domain] of GOLDEN_PROVIDER_TO_DOMAIN) {
      expect(CSPValidator.getProviderDomain(id)).toBe(domain);
    }
    expect(CSPValidator.getProviderDomain('no-such-provider')).toBeNull();
  });

  it('AI_PROVIDER_HOST_PERMISSIONS is exactly the 14 golden entries in order', () => {
    expect([...AI_PROVIDER_HOST_PERMISSIONS]).toEqual(GOLDEN_REQUIRED_PERMISSIONS);
  });

  it('OPTIONAL head is exactly the 26 golden entries in order, tail is the list-source SSOT', () => {
    expect([...OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS].slice(0, GOLDEN_OPTIONAL_PERMISSIONS_HEAD.length)).toEqual(
      GOLDEN_OPTIONAL_PERMISSIONS_HEAD,
    );
    expect([...OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS].slice(GOLDEN_OPTIONAL_PERMISSIONS_HEAD.length)).toEqual(
      ALL_LIST_SOURCES.map((source) => `${source.origin}/*`),
    );
  });

  it('ALLOWED_AI_PROVIDER_DOMAINS head is exactly the 38 golden entries, tail is list hosts + localhost', () => {
    // Set-identical to the legacy literal; the legacy interleaved order is a
    // documented delta — derivation emits tier-blocked row order. Order is
    // cosmetic: the gate uses includes() and set insertion.
    expect(new Set(ALLOWED_AI_PROVIDER_DOMAINS.slice(0, GOLDEN_WHITELIST_HEAD.length))).toEqual(
      new Set(GOLDEN_WHITELIST_HEAD),
    );
    expect(ALLOWED_AI_PROVIDER_DOMAINS.slice(0, GOLDEN_WHITELIST_HEAD.length)).toHaveLength(
      GOLDEN_WHITELIST_HEAD.length,
    );
    expect(ALLOWED_AI_PROVIDER_DOMAINS.slice(GOLDEN_WHITELIST_HEAD.length)).toEqual([
      ...ALL_LIST_SOURCES.map((source) => source.host),
      'localhost',
      '127.0.0.1',
    ]);
  });
});
