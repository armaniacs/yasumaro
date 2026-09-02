/**
 * ollamaOriginRule.ts
 * Ollama宛リクエストのOriginヘッダーをdeclarativeNetRequestで強制削除するルール。
 *
 * OllamaはデフォルトでOriginヘッダーを見てCORS拒否することがあり、
 * Ollama側の OLLAMA_ORIGINS 設定変更を避けるため拡張機能側でヘッダーを削除する。
 */
import { isAllowedProviderBaseUrl } from '../ai/providerCatalog.js';

/** 動的ルールの固定ID。baseUrl変更時はこのIDを removeRuleIds に含めて置き換える。 */
export const OLLAMA_ORIGIN_RULE_ID = 1;

/**
 * OllamaのbaseUrlから、Originヘッダー削除ルールを構築する。
 * 無効なURL、またはSSRF allowlist（isAllowedProviderBaseUrl）を通らないURLの場合はnullを返す
 * （呼び出し側はルール未登録として扱う）。
 *
 * urlFilterはホスト+ポートまで厳密指定する。requestDomainsはポートを区別できず、
 * 同一ホスト上の他のローカルプロバイダ（LM Studio、Obsidian REST API等）にも
 * ルールが適用されてしまうため使わない。
 */
export function buildOllamaOriginRule(baseUrl: string): chrome.declarativeNetRequest.Rule | null {
  if (!isAllowedProviderBaseUrl(baseUrl, true)) return null;

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return null;
  }
  if (!parsed.hostname) return null;

  return {
    id: OLLAMA_ORIGIN_RULE_ID,
    priority: 1,
    action: {
      type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
      requestHeaders: [
        {
          header: 'Origin',
          operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation,
        },
      ],
    },
    condition: {
      urlFilter: `||${parsed.host}/`,
      initiatorDomains: [chrome.runtime.id],
      resourceTypes: [
        'xmlhttprequest' as chrome.declarativeNetRequest.ResourceType,
        'other' as chrome.declarativeNetRequest.ResourceType,
      ],
    },
  };
}

/**
 * 現在のOllama baseUrlに合わせて動的ルールを同期する。
 * 常にOLLAMA_ORIGIN_RULE_IDを削除してから、有効なbaseUrlがあれば1件追加する（冪等）。
 */
export async function syncOllamaOriginRule(baseUrl: string): Promise<void> {
  const rule = buildOllamaOriginRule(baseUrl);
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [OLLAMA_ORIGIN_RULE_ID],
    addRules: rule ? [rule] : [],
  });
}
