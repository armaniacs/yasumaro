/**
 * cspValidatorSelfAllow.test.ts
 *
 * PBI 2026-08-29-19: CSPValidator.initializeFromSettings が設定由来の
 * base URL hostname を無条件で条件付き CSP 許可リストへ追加していた
 * (self-allow) 構造を締め直す。汚染された設定 (インポート経由の悪意ある
 * 設定ファイル等) で private IP / metadata endpoint / 非 https の非 localhost
 * へ接続が許可されるのを防ぐ。
 *
 * ガードは src/background/ai/providerRegistry.ts の isAllowedProviderBaseUrl
 * を再利用する。既存 cspValidator.test.ts は CRLF のため、新規ケースは
 * この LF ファイルに置く。
 */

import { vi } from 'vitest';
import { CSPValidator } from '../cspValidator.js';

describe('CSPValidator - self-allow hardening (PBI 29-19)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    CSPValidator.reset();
  });

  describe('汚染設定は条件付き CSP に追加されない', () => {
    it('provider_base_url が metadata endpoint (169.254.169.254) の場合は追加しない', () => {
      CSPValidator.initializeFromSettings({
        conditional_csp_providers: [],
        provider_base_url: 'http://169.254.169.254/latest/meta-data/',
      });
      expect(CSPValidator.isUrlAllowed('http://169.254.169.254/latest/meta-data/')).toBe(false);
    });

    it('provider_base_url が metadata.google.internal の場合は追加しない', () => {
      CSPValidator.initializeFromSettings({
        conditional_csp_providers: [],
        provider_base_url: 'http://metadata.google.internal/computeMetadata/v1/',
      });
      expect(CSPValidator.isUrlAllowed('http://metadata.google.internal/computeMetadata/v1/')).toBe(false);
    });

    it('provider_base_url が private IP (10.x/192.168.x/172.16-31.x) の場合は追加しない', () => {
      CSPValidator.initializeFromSettings({
        conditional_csp_providers: [],
        provider_base_url: 'http://192.168.1.50:8080/v1',
      });
      expect(CSPValidator.isUrlAllowed('http://192.168.1.50:8080/v1/models')).toBe(false);

      CSPValidator.reset();
      CSPValidator.initializeFromSettings({
        conditional_csp_providers: [],
        provider_base_url: 'https://10.0.0.5/v1',
      });
      expect(CSPValidator.isUrlAllowed('https://10.0.0.5/v1/models')).toBe(false);
    });

    it('openai_base_url が非 https の非 localhost (http://evil.example) の場合は追加しない', () => {
      CSPValidator.initializeFromSettings({
        conditional_csp_providers: [],
        openai_base_url: 'http://evil.example/v1',
      });
      expect(CSPValidator.isUrlAllowed('http://evil.example/v1/models')).toBe(false);
    });

    it('非 http(s) スキーム (file:, ftp:) は追加しない', () => {
      CSPValidator.initializeFromSettings({
        conditional_csp_providers: [],
        provider_base_url: 'ftp://ftp.example.com/',
      });
      expect(CSPValidator.isUrlAllowed('ftp://ftp.example.com/models')).toBe(false);
    });
  });

  describe('正当な設定は引き続き許可される (回帰防止)', () => {
    it('正当な https カスタムエンドポイントは追加される', () => {
      CSPValidator.initializeFromSettings({
        conditional_csp_providers: [],
        provider_base_url: 'https://custom-openai.example.com/v1',
      });
      expect(CSPValidator.isUrlAllowed('https://custom-openai.example.com/v1/chat/completions')).toBe(true);
    });

    it('localhost のカスタムエンドポイント (Ollama/LM Studio) は追加される', () => {
      CSPValidator.initializeFromSettings({
        conditional_csp_providers: [],
        'ollama_base_url': 'http://localhost:11434/v1',
      });
      expect(CSPValidator.isUrlAllowed('http://localhost:11434/v1/models')).toBe(true);
    });

    it('127.0.0.1 のカスタムエンドポイントは追加される', () => {
      CSPValidator.initializeFromSettings({
        conditional_csp_providers: [],
        'lm-studio_base_url': 'http://127.0.0.1:1234/v1',
      });
      expect(CSPValidator.isUrlAllowed('http://127.0.0.1:1234/v1/models')).toBe(true);
    });
  });
});
