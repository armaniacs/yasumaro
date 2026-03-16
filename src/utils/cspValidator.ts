/**
 * cspValidator.ts
 * CSP Validator - 条件付きCSPの実装（URL検証による代替）
 * 設定したAIプロバイダーのみCSPに含めるためのURL検証
 */

import { logWarn, ErrorCode } from './logger.js';

/**
 * デフォルトAIプロバイダードメイン（常に許可）
 */
const DEFAULT_ALLOWED_DOMAINS = [
  'generativelanguage.googleapis.com', // Google Gemini
  'api.openai.com', // OpenAI Official
  'api.anthropic.com', // Anthropic Claude
  'api.groq.com', // Groq
  'mistral.ai', // Mistral
  'deepseek.com', // DeepSeek
  'perplexity.ai', // Perplexity
  'jina.ai', // Jina
  'voyageai.com' // Voyage
];

/**
 * AIプロバイダーID -> ドメインマッピング
 */
const PROVIDER_TO_DOMAIN: Record<string, string> = {
  'huggingface': 'api-inference.huggingface.co',
  'openrouter': 'api.openrouter.ai',
  'deepinfra': 'deepinfra.com',
  'cerebras': 'cerebras.ai',
  'venice': 'api.venice.ai',
  'scaleway': 'api.scaleway.ai',
  'nano-gpt': 'nano-gpt.com',
  'poe': 'api.poe.com',
  'chutes': 'llm.chutes.ai',
  'sarvam': 'api.sarvam.ai',
  'nebius': 'nebius.com',
  'sambanova': 'sambanova.ai',
  'nscale': 'nscale.com',
  'featherless': 'featherless.ai',
  'galadriel': 'galadriel.com',
  'recraft': 'recraft.ai',
  'volcengine': 'volcengine.com',
  'z-ai': 'z.ai',
  'wandb': 'wandb.ai',
  'helicone': 'ai-gateway.helicone.ai',
  'publicai': 'api.publicai.co',
  'synthetic': 'api.synthetic.new',
  'stima': 'api.stima.tech',
  'abliteration': 'api.abliteration.ai',
  'llamagate': 'api.llamagate.dev',
  'gmi': 'api.gmi-serving.com',
  'xiaomimimo': 'xiaomimimo.com',
  'sakura': 'api.ai.sakura.ad.jp'
};

/**
 * 除外ドメイン（CSPから削除したが、optionalで許可できる）
 */
const OPTIONAL_DOMAINS = [
  'raw.githubusercontent.com', // GitHub Raw Content (uBlock Import)
  'gitlab.com' // GitLab (uBlock Import)
];

/**
 * CSP Validator クラス
 * 設定したAIプロバイダーのみCSPに含めるためのURL検証
 */
export class CSPValidator {
  private static allowedDomains: Set<string> = new Set(DEFAULT_ALLOWED_DOMAINS);
  private static optionalDomains: Set<string> = new Set(OPTIONAL_DOMAINS);
  private static initialized = false;

  /**
   * 設定ファイルから許可ドメインを初期化
   * @param settings - ユーザー設定
   */
  static initializeFromSettings(settings: Record<string, unknown>): void {
    // デフォルトドメインは常に許可
    CSPValidator.allowedDomains = new Set(DEFAULT_ALLOWED_DOMAINS);

    // ユーザーが選択したAIプロバイダードメインを追加
    const allowedProviders = settings.conditional_csp_providers as string[] || [];
    for (const provider of allowedProviders) {
      const domain = CSPValidator.extractDomainFromProvider(provider);
      if (domain && !CSPValidator.allowedDomains.has(domain)) {
        CSPValidator.allowedDomains.add(domain);
      } else if (!domain) {
        logWarn(
          'Unknown AI provider',
          { provider },
          ErrorCode.UNKNOWN_AI_PROVIDER,
          'cspValidator'
        );
      }
    }

    CSPValidator.initialized = true; // 初回ロードフラグ（fetch.ts内での重複初期化抑制用）
  }

  /**
   * URLが許可されているか確認
   * @param url - チェック対象のURL
   * @returns 許可されているかどうか
   */
  static isUrlAllowed(url: string): boolean {
    try {
      const parsed = new URL(url);
      const domain = parsed.hostname;

      // デフォルト・ユーザー選択ドメインに含まれているか
      if (CSPValidator.allowedDomains.has(domain)) {
        return true;
      }

      // *.openai.com マッチ
      if (domain.endsWith('.openai.com')) {
        return true;
      }

      // Optionalドメイン（GitHub/GitLab）
      if (CSPValidator.optionalDomains.has(domain)) {
        return true;
      }

      // 非AIドメイン（Tranco, uBlock, localhost）
      if (domain === 'tranco-list.eu' ||
          domain === 'easylist.to' ||
          domain === 'pgl.yoyo.org' ||
          domain === 'nsfw.oisd.nl' ||
          domain === 'localhost' ||
          domain.startsWith('127.0.0.1')) {
        return true;
      }

      return false;
    } catch (error) {
      // Log error without including the URL to avoid logging sensitive data
      logWarn(
        'CSP validation failed for URL',
        { error: error instanceof Error ? error.message : String(error) },
        undefined,
        'cspValidator'
      );
      return false;
    }
  }

  /**
   * URLがAIプロバイダーURLかどうか確認
   * @param url - チェック対象のURL
   * @returns AIプロバイダーURLかどうか
   */
  static isAProviderUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const domain = parsed.hostname;

      // すべてのプロバイダードメインをチェック
      const allProviderDomains = [
        ...DEFAULT_ALLOWED_DOMAINS,
        ...Object.values(PROVIDER_TO_DOMAIN)
      ];

      if (allProviderDomains.includes(domain)) {
        return true;
      }

      if (domain.endsWith('.openai.com')) {
        return true;
      }

      return false;
    } catch (error) {
      // Log error without including the URL to avoid logging sensitive data
      logWarn(
        'CSP provider URL validation failed',
        { error: error instanceof Error ? error.message : String(error) },
        undefined,
        'cspValidator'
      );
      return false;
    }
  }

  /**
   * AIプロバイダー名からドメインを抽出
   * @param provider - プロバイダーID
   * @returns ドメイン or null
   */
  private static extractDomainFromProvider(provider: string): string | null {
    return PROVIDER_TO_DOMAIN[provider] || null;
  }

  /**
   * 利用可能なプロバイダーリストを取得
   * @returns プロバイダーID配列
   */
  static getAvailableProviders(): string[] {
    return Object.keys(PROVIDER_TO_DOMAIN);
  }

  /**
   * プロバイダーIDからドメインを取得
   * @param provider - プロバイダーID
   * @returns ドメイン or null
   */
  static getProviderDomain(provider: string): string | null {
    return PROVIDER_TO_DOMAIN[provider] || null;
  }

  /**
   * 現在許可されているドメインを取得
   * @returns ドメイン配列
   */
  static getAllowedDomains(): string[] {
    return Array.from(CSPValidator.allowedDomains);
  }

  /**
   * Validatorをリセット（テスト用）
   */
  static reset(): void {
    CSPValidator.allowedDomains = new Set(DEFAULT_ALLOWED_DOMAINS);
    CSPValidator.initialized = false;
  }

  /**
   * 初期化状態を取得
   * @returns 初期化済みかどうか
   */
  static isInitialized(): boolean {
    return CSPValidator.initialized;
  }
}

/**
 * fetch実行前にURL検証を行う安全なfetch関数
 * @param url - リクエスト先URL
 * @param options - Fetchオプション
 * @returns Fetchレスポンス
 * @throws 未許可URLの場合エラー
 */
export async function safeFetch(url: string, options?: RequestInit): Promise<Response> {
  // 初期化前はデフォルトドメインのみ許可（Service Worker再起動後のセキュリティ対策）
  if (!CSPValidator.isInitialized()) {
    if (CSPValidator.isUrlAllowed(url)) {
      return fetch(url, options);
    }
    const error = new Error(`URL blocked: CSP not initialized for ${url}`);
    (error as any).code = 'CSP_NOT_INITIALIZED';
    throw error;
  }
  
  if (!CSPValidator.isUrlAllowed(url)) {
    const error = new Error(`URL blocked by CSP policy: ${url}`);
    (error as any).code = 'CSP_BLOCKED';
    throw error;
  }
  return fetch(url, options);
}

/**
 * URLがAIプロバイダーURLかつ許可されていない場合のエラーメッセージを取得
 * @param url - チェック対象URL
 * @returns エラーメッセージ or null
 */
export function getCspErrorMessage(url: string): string | null {
  try {
    if (CSPValidator.isAProviderUrl(url) && !CSPValidator.isUrlAllowed(url)) {
      const hostname = new URL(url).hostname;
      return `APIプロバイダー "${hostname}" は条件付きCSPによりブロックされました。Dashboard設定で追加してください。`;
    }
  } catch (error) {
    logWarn(
      'Failed to generate CSP error message',
      { error: error instanceof Error ? error.message : String(error) },
      undefined,
      'cspValidator'
    );
  }
  return null;
}