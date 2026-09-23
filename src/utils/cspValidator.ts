/**
 * cspValidator.ts
 * 実行時 CSP 検証（二層セキュリティモデルの第二層）
 *
 * 設計: manifest.json connect-src（第一層）は接続可能ドメインの上限。
 * このバリデーターはユーザー設定済みプロバイダーのみ許可する（第二層）。
 * 詳細: dev-docs/ADR/0002-csp-layered-security.md
 */

import { ErrorCode } from './logger/types.js';
import { logWarn } from './logger/api.js';
import { errorMessage } from './errorUtils.js';
import { ALL_LIST_SOURCES } from './listSources.js';
import { ALLOWED_LOCALHOST_PORTS } from './ssrfGuard.js';
import { pickDefined } from './objectUtils.js';
import { StorageKeys } from './storage/types.js';
import {
  validateObsidianHost,
  validateObsidianPort,
  validateObsidianProtocol,
} from './obsidianConfigValidator.js';
import {
  deriveConditionalCspEntries,
  deriveRequiredDomains,
  isProviderOriginAuthorized,
  PROVIDER_ALLOWLIST_ROWS,
  type ProviderAllowlistRow,
} from './storage/providerAllowlist.js';

class CspError extends Error {
    code: string;
    constructor(message: string, code: string) {
        super(message);
        this.code = code;
    }
}

/**
 * デフォルトAIプロバイダードメイン（常に許可）
 *
 * Derived from the neutral PROVIDER_ALLOWLIST_ROWS (required tier), which
 * shares the set with wxt.config.ts manifest `host_permissions`
 * (AI_PROVIDER_HOST_PERMISSIONS). Domains missing here are fail-closed
 * blocked by this validator even when the manifest allows them.
 */
const DEFAULT_ALLOWED_DOMAINS: string[] = deriveRequiredDomains();

/**
 * AIプロバイダーID -> ドメインマッピング
 *
 * Derived from the neutral PROVIDER_ALLOWLIST_ROWS (conditionalCsp rows);
 * the id set no longer needs hand-syncing with the domain table.
 */
const PROVIDER_TO_DOMAIN: Record<string, string> = Object.fromEntries(
  deriveConditionalCspEntries().map((entry) => [entry.id, entry.domain]),
);

/**
 * 除外ドメイン（CSPから削除したが、optionalで許可できる）
 *
 * Derived from the LIST_SOURCES SSOT (PBI: Checking Team 2026-09-22 —
 * Maintainability Medium). The two GitHub/GitLab hosts used to be
 * hand-duplicated here; deriving keeps the optional set in sync when a
 * list source is added/removed (the 4 remaining hosts below were already
 * hand-written and are folded into the same derivation via
 * FILTER_LIST_SOURCES + TRANCO_METADATA_SOURCE).
 */
const LIST_SOURCE_HOSTS: ReadonlySet<string> = new Set(ALL_LIST_SOURCES.map((source) => source.host));
const OPTIONAL_DOMAINS = ALL_LIST_SOURCES
  .filter((source) => source.host === 'raw.githubusercontent.com' || source.host === 'gitlab.com')
  .map((source) => source.host);

/**
 * キュー内のリクエスト情報
 */
interface QueuedRequest {
  url: string;
  options?: RequestInit;
  resolve: (value: Response) => void;
  reject: (reason?: unknown) => void;
}

/**
 * CSP Validator クラス
 * 設定したAIプロバイダーのみCSPに含めるためのURL検証
 */
export class CSPValidator {
  private static allowedDomains: Set<string> = new Set(DEFAULT_ALLOWED_DOMAINS);
  private static optionalDomains: Set<string> = new Set(OPTIONAL_DOMAINS);
  private static initialized = false;
  /**
   * Exact origins derived from the saved Obsidian settings (host/port/
   * protocol via the shared validators). Saved vault traffic — remote https
   * vaults and loopback vaults on custom ports — passes the fetch gate on
   * origin equality while unsaved origins stay blocked.
   */
  private static savedObsidianOrigins: Set<string> = new Set();

  // 初期化Promiseとリクエストキュー（レースコンディション修正用）
  private static initPromise: Promise<void> | null = null;
  private static resolveInit: (() => void) | null = null;
  private static requestQueue: QueuedRequest[] = [];
  public static readonly REQUEST_QUEUE_LIMIT = 100; // キュー上限（テスト用に公開）
  private static initializing = false; // 初期化中フラグ

  /**
   * 初期化の準備（非同期初期化用）
   * このメソッドを呼ぶと、それ以降のsafeFetchはキューイングされる
   */
  static prepareInitialization(): void {
    if (!CSPValidator.initPromise && !CSPValidator.initialized) {
      CSPValidator.initializing = true;
      CSPValidator.initPromise = new Promise<void>((resolve) => {
        CSPValidator.resolveInit = resolve;
      });
    }
  }

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

    // 設定由来の Base URL は「信頼できる定数」ではないため、暗黙に許可リストへ
    // 入れる前に origin 認可で締め直す（pinned row domain / ユーザー確認済み
    // origin / loopback のみ）。設定値そのものを根拠にした自己認可は許さない
    // — 汚染された provider_base_url が条件付き CSP を寛解させない。
    const confirmedOrigins = new Set(
      Object.values(
        (settings[StorageKeys.CONFIRMED_PROVIDER_ORIGINS] as Record<string, string[]> | undefined) ?? {},
      ).flat(),
    );
    const addBaseUrlDomain = (rawUrl: string, row: ProviderAllowlistRow): void => {
      if (!isProviderOriginAuthorized(rawUrl, row, confirmedOrigins).authorized) return;
      try {
        const domain = new URL(rawUrl).hostname;
        if (domain) {
          CSPValidator.allowedDomains.add(domain);
        }
      } catch {
        // 無効なURLは無視
      }
    };

    // Provider baseUrl domains — derived from the neutral allowlist table's
    // baseUrlKey + isLocal (no hardcoded switch, no background-tier import)
    for (const entry of PROVIDER_ALLOWLIST_ROWS) {
      if (!entry.baseUrlKey) continue;
      const rawUrl = settings[entry.baseUrlKey] as string | undefined;
      if (rawUrl) {
        addBaseUrlDomain(rawUrl, entry);
      }
    }

    // Saved Obsidian vault origin (SSOT-derived). An invalid saved config
    // contributes nothing rather than widening the gate.
    try {
      const rawHost = settings[StorageKeys.OBSIDIAN_HOST] as string | undefined | null;
      const rawPort = settings[StorageKeys.OBSIDIAN_PORT] as string | number | undefined | null;
      const rawProtocol = settings[StorageKeys.OBSIDIAN_PROTOCOL] as string | undefined | null;
      const savedProtocol = validateObsidianProtocol(rawProtocol, typeof rawHost === 'string' ? rawHost : undefined);
      const savedHost = validateObsidianHost(rawHost);
      const savedPort = validateObsidianPort(rawPort);
      CSPValidator.savedObsidianOrigins = new Set(
        [new URL(`${savedProtocol}://${savedHost}:${savedPort}`).origin],
      );
    } catch {
      CSPValidator.savedObsidianOrigins = new Set();
    }

    CSPValidator.initialized = true; // 初回ロードフラグ（fetch.ts内での重複初期化抑制用）
    CSPValidator.initializing = false;

    // 初期化完了を通知し、キュー内のリクエストを処理
    CSPValidator.completeInitialization();
  }

  /**
   * 初期化完了を通知し、キュー内のリクエストを処理
   */
  private static completeInitialization(): void {
    if (CSPValidator.resolveInit) {
      CSPValidator.resolveInit();
      CSPValidator.resolveInit = null;
    }
    CSPValidator.processQueue();
  }

  /**
   * キュー内のリクエストを処理
   */
  private static processQueue(): void {
    const queue = [...CSPValidator.requestQueue];
    CSPValidator.requestQueue = [];

    for (const { url, options, resolve, reject } of queue) {
      // 許可チェック後に直接fetchを実行（再帰的なsafeFetch呼び出しを回避）
      if (CSPValidator.isUrlAllowed(url)) {
        fetch(url, options).then(resolve).catch(reject);
      } else {
        const error = new CspError(`URL blocked by CSP policy: ${url}`, 'CSP_BLOCKED');
        reject(error);
      }
    }
  }

  /**
   * リクエストをキューに追加（キュー上限チェック含む）
   * @param url - リクエストURL
   * @param options - Fetchオプション
   * @returnsPromise<Response> - リクエストPromise or エラー
   */
  static enqueueQueuedRequest(url: string, options?: RequestInit): Promise<Response> {
    if (CSPValidator.requestQueue.length >= CSPValidator.REQUEST_QUEUE_LIMIT) {
      throw new CspError(`Request queue full: ${url}`, 'CSP_QUEUE_FULL');
    }

    return new Promise((resolve, reject) => {
      CSPValidator.requestQueue.push({ url, ...pickDefined({ options }), resolve, reject });
    });
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

      // 非AIドメイン（Tranco, uBlock）— LIST_SOURCES SSOT から派生
      // （Checking Team 2026-09-22: Maintainability Medium — 旧4ドメイン直書きを廃止）
      if (LIST_SOURCE_HOSTS.has(domain)) {
        return true;
      }

      // Saved Obsidian vault origin (exact match). Checked before the
      // generic localhost rules so a saved loopback vault on a custom port
      // (outside ALLOWED_LOCALHOST_PORTS) still passes.
      if (CSPValidator.savedObsidianOrigins.has(parsed.origin)) {
        return true;
      }

      // VULN-013 fix: localhost/loopback with port allowlist
      // Only allow ports declared in host_permissions (single source: ssrfGuard.ts)
      const port = parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === 'https:' ? 443 : 80);

      if (domain === 'localhost') {
        return ALLOWED_LOCALHOST_PORTS.has(port);
      }

      // VULN-013 fix: strict IPv4 loopback check (anchored regex)
      // Prevents '127.attacker.example' from matching
      if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(domain)) {
        return ALLOWED_LOCALHOST_PORTS.has(port);
      }

      return false;
    } catch (error) {
      // Log error without including the URL to avoid logging sensitive data
      logWarn(
        'CSP validation failed for URL',
        { error: errorMessage(error) },
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
        { error: errorMessage(error) },
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
    CSPValidator.savedObsidianOrigins = new Set();
    CSPValidator.initialized = false;
    CSPValidator.initializing = false;
    CSPValidator.initPromise = null;
    CSPValidator.resolveInit = null;
    CSPValidator.requestQueue = [];
  }

  /**
   * 初期化状態を取得
   * @returns 初期化済みかどうか
   */
  static isInitialized(): boolean {
    return CSPValidator.initialized;
  }

  /**
   * 初期化中かどうかを取得
   * @returns 初期化中かどうか
   */
  static isInitializing(): boolean {
    return CSPValidator.initializing;
  }

  /**
   * 初期化Promiseを取得（テスト用）
   * @returns 初期化Promise
   */
  static getInitPromise(): Promise<void> | null {
    return CSPValidator.initPromise;
  }

  /**
   * キュー内のリクエスト数を取得（テスト用）
   * @returns キュー内のリクエスト数
   */
  static getQueueSize(): number {
    return CSPValidator.requestQueue.length;
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
  // 初期化中はリクエストをキューイング
  if (CSPValidator.isInitializing()) {
    return CSPValidator.enqueueQueuedRequest(url, options);
  }

  // 初期化済みの通常処理
  if (!CSPValidator.isUrlAllowed(url)) {
    throw new CspError('URL blocked by CSP policy', 'CSP_BLOCKED');
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
      { error: errorMessage(error) },
      undefined,
      'cspValidator'
    );
  }
  return null;
}