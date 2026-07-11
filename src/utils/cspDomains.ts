/**
 * cspDomains.ts
 * Single source of truth for AI-provider host permission domains, shared
 * between wxt.config.ts's manifest permissions and its CSP connect-src
 * (M24). Adding a provider domain here updates both automatically instead
 * of requiring the CSP string to be edited by hand in a second place.
 */

/** Always-granted AI provider host permissions (manifest `host_permissions`). */
export const AI_PROVIDER_HOST_PERMISSIONS = [
  'https://generativelanguage.googleapis.com/*',
  'https://api.openai.com/*',
  'https://*.openai.com/*',
  'https://api.anthropic.com/*',
  'https://api.groq.com/*',
  'https://mistral.ai/*',
  'https://deepseek.com/*',
  'https://voyageai.com/*',
  'https://volcengine.com/*',
  'https://z.ai/*',
  'https://wandb.ai/*',
  'https://api.ai.sakura.ad.jp/*',
] as const;

/** Opt-in AI provider / list-source host permissions (manifest `optional_host_permissions`). */
export const OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS = [
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
  'https://raw.githubusercontent.com/*',
  'https://gitlab.com/*',
  'https://tranco-list.eu/*',
  'https://easylist.to/*',
  'https://pgl.yoyo.org/*',
  'https://nsfw.oisd.nl/*',
] as const;

/**
 * Strips the manifest `/*` suffix from each required + optional host
 * permission, producing the domain list for CSP's connect-src directive.
 */
export function buildConnectSrcDomains(): string[] {
  return [...AI_PROVIDER_HOST_PERMISSIONS, ...OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS].map(
    (perm) => perm.replace(/\/\*$/, '')
  );
}
