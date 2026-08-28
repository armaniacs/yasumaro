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
    it('正常なURLからホスト+ポートを含むurlFilterを生成できる', () => {
      const rule = buildOllamaOriginRule('http://localhost:11434/v1');

      expect(rule).not.toBeNull();
      expect(rule?.id).toBe(OLLAMA_ORIGIN_RULE_ID);
      expect(rule?.condition.urlFilter).toBe('||localhost:11434/');
    });

    it('ポートが異なればurlFilterも異なるポートになる（他ローカルプロバイダへの誤爆防止）', () => {
      const rule = buildOllamaOriginRule('http://localhost:8080/api');

      expect(rule).not.toBeNull();
      expect(rule?.condition.urlFilter).toBe('||localhost:8080/');
    });

    it('IPアドレスのURLでも動作する', () => {
      const rule = buildOllamaOriginRule('http://127.0.0.1:11434');

      expect(rule).not.toBeNull();
      expect(rule?.condition.urlFilter).toBe('||127.0.0.1:11434/');
    });

    it('空文字列の場合はnullを返す', () => {
      expect(buildOllamaOriginRule('')).toBeNull();
    });

    it('URLとしてパースできない文字列の場合はnullを返す', () => {
      expect(buildOllamaOriginRule('not a valid url')).toBeNull();
    });

    it('SSRF allowlistを通らないホスト（メタデータサービス）の場合はnullを返す', () => {
      expect(buildOllamaOriginRule('http://169.254.169.254/v1')).toBeNull();
    });

    it('SSRF allowlistを通らないホスト（プライベートIPレンジ）の場合はnullを返す', () => {
      expect(buildOllamaOriginRule('http://192.168.1.10:11434/v1')).toBeNull();
    });

    it('生成されるルールのaction.requestHeadersがOriginヘッダーのremove操作である', () => {
      const rule = buildOllamaOriginRule('http://localhost:11434');

      expect(rule?.action.type).toBe('modifyHeaders');
      expect(rule?.action.requestHeaders).toEqual([
        { header: 'Origin', operation: 'remove' },
      ]);
    });

    it('生成されるルールのresourceTypesがxmlhttprequestとotherを含む', () => {
      const rule = buildOllamaOriginRule('http://localhost:11434');

      expect(rule?.condition.resourceTypes).toEqual(['xmlhttprequest', 'other']);
    });

    it('生成されるルールのinitiatorDomainsが拡張機能自身に限定されている', () => {
      const rule = buildOllamaOriginRule('http://localhost:11434');

      expect(rule?.condition.initiatorDomains).toEqual([chrome.runtime.id]);
    });
  });

  describe('syncOllamaOriginRule', () => {
    it('正常なbaseUrlの場合、既存ルールを削除し新規ルールを1件追加する', async () => {
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

    it('不正なbaseUrlの場合、addRulesを空配列にしてルールを削除のみ行う', async () => {
      await syncOllamaOriginRule('invalid-url');

      expect(chrome.declarativeNetRequest.updateDynamicRules).toHaveBeenCalledWith({
        removeRuleIds: [OLLAMA_ORIGIN_RULE_ID],
        addRules: [],
      });
    });

    it('常に既存ルールIDを指定して重複登録を防ぐ', async () => {
      await syncOllamaOriginRule('http://localhost:11434');

      const callArgs = vi.mocked(chrome.declarativeNetRequest.updateDynamicRules).mock.calls[0]?.[0];
      expect(callArgs?.removeRuleIds).toEqual([OLLAMA_ORIGIN_RULE_ID]);
    });
  });
});
