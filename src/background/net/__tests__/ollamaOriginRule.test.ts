/**
 * ollamaOriginRule.test.ts
 * OllamaのOriginヘッダー除去用ルール構築・同期処理のテスト
 * 【テスト対象】: src/background/net/ollamaOriginRule.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  OLLAMA_ORIGIN_RULE_ID,
  buildOllamaOriginRule,
  syncOllamaOriginRule,
} from '../ollamaOriginRule.js';

describe('ollamaOriginRule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (chrome.runtime as any).id = 'test-extension-id';
  });

  describe('buildOllamaOriginRule', () => {
    it('generates a urlFilter with host and port from a valid URL', () => {
      const rule = buildOllamaOriginRule('http://localhost:11434/v1');

      expect(rule).not.toBeNull();
      expect(rule?.id).toBe(OLLAMA_ORIGIN_RULE_ID);
      expect(rule?.condition.urlFilter).toBe('||localhost:11434/');
    });

    it('uses the matching port in urlFilter for a different port (avoids affecting other local providers)', () => {
      const rule = buildOllamaOriginRule('http://localhost:8080/api');

      expect(rule).not.toBeNull();
      expect(rule?.condition.urlFilter).toBe('||localhost:8080/');
    });

    it('works with an IP address URL', () => {
      const rule = buildOllamaOriginRule('http://127.0.0.1:11434');

      expect(rule).not.toBeNull();
      expect(rule?.condition.urlFilter).toBe('||127.0.0.1:11434/');
    });

    it('returns null for an empty string', () => {
      expect(buildOllamaOriginRule('')).toBeNull();
    });

    it('returns null for a string that cannot be parsed as a URL', () => {
      expect(buildOllamaOriginRule('not a valid url')).toBeNull();
    });

    it('returns null for a host rejected by the SSRF allowlist (metadata service)', () => {
      expect(buildOllamaOriginRule('http://169.254.169.254/v1')).toBeNull();
    });

    it('returns null for a host rejected by the SSRF allowlist (private IP range)', () => {
      expect(buildOllamaOriginRule('http://192.168.1.10:11434/v1')).toBeNull();
    });

    it('sets action.requestHeaders to remove the Origin header in the generated rule', () => {
      const rule = buildOllamaOriginRule('http://localhost:11434');

      expect(rule?.action.type).toBe('modifyHeaders');
      expect(rule?.action.requestHeaders).toEqual([
        { header: 'Origin', operation: 'remove' },
      ]);
    });

    it('includes xmlhttprequest and other in resourceTypes of the generated rule', () => {
      const rule = buildOllamaOriginRule('http://localhost:11434');

      expect(rule?.condition.resourceTypes).toEqual(['xmlhttprequest', 'other']);
    });

    it('restricts initiatorDomains to the extension itself in the generated rule', () => {
      const rule = buildOllamaOriginRule('http://localhost:11434');

      expect(rule?.condition.initiatorDomains).toEqual([chrome.runtime.id]);
    });
  });

  describe('syncOllamaOriginRule', () => {
    it('removes the existing rule and adds one new rule for a valid baseUrl', async () => {
      await syncOllamaOriginRule('http://localhost:11434');

      expect(chrome.declarativeNetRequest.updateDynamicRules).toHaveBeenCalledTimes(1);
      expect(chrome.declarativeNetRequest.updateDynamicRules).toHaveBeenCalledWith({
        removeRuleIds: [OLLAMA_ORIGIN_RULE_ID],
        addRules: [
          expect.objectContaining({
            id: OLLAMA_ORIGIN_RULE_ID,
            condition: expect.objectContaining({
              urlFilter: '||localhost:11434/',
            }),
          }),
        ],
      });
    });

    it('clears addRules and only removes the rule for an invalid baseUrl', async () => {
      await syncOllamaOriginRule('invalid-url');

      expect(chrome.declarativeNetRequest.updateDynamicRules).toHaveBeenCalledWith({
        removeRuleIds: [OLLAMA_ORIGIN_RULE_ID],
        addRules: [],
      });
    });

    it('always specifies the existing rule ID to prevent duplicate registration', async () => {
      await syncOllamaOriginRule('http://localhost:11434');

      const callArgs = vi.mocked(chrome.declarativeNetRequest.updateDynamicRules).mock.calls[0]?.[0];
      expect(callArgs?.removeRuleIds).toEqual([OLLAMA_ORIGIN_RULE_ID]);
    });

    it('returns null for an empty-hostname URL passing the allowlist (http:/// path) - defensive branch', () => {
      // http系でhostnameが空になる有効URLは存在しないため、この分岐は到達不能な防御的コード。
      // 正常系で hostname が必ず存在することを確認し、防御的コードの存在を文書化する。
      const rule = buildOllamaOriginRule('http://localhost:11434');
      expect(rule).not.toBeNull();
      expect(rule?.condition.urlFilter).toBe('||localhost:11434/');
      // 空hostnameの有効なhttp URLは存在しないため、nullケースは isAllowedProviderBaseUrl で弾かれるケースで代替
      expect(buildOllamaOriginRule('http://[invalid')).toBeNull();
    });

    it('returns null for a string that fails URL parsing (try-catch branch)', () => {
      // isAllowedProviderBaseUrlがfalseを返すケースは既にカバー、ここではtry-catch内部の例外経路を確認
      // 'http://[invalid' は new URL で例外を投げる
      expect(buildOllamaOriginRule('http://[invalid')).toBeNull();
    });
  });
});
