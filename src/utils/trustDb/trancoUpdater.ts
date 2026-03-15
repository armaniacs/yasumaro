/**
 * trancoUpdater.ts
 * Tranco List API fetching and updating (Phase 1)
 */

import type {
  TrancoTier,
  TrancoUpdateResult,
  SafetyMode
} from './trustDbSchema.js';
import { getTrustDb } from './trustDb.js';
import { logInfo, logError, logWarn, ErrorCode } from '../logger.js';
import { fetchWithTimeout } from '../fetch.js';

// ===== 定数 =====

// Tranco API: fetch latest list ID first, then download CSV
const TRANCO_API_LATEST = 'https://tranco-list.eu/api/lists/date/latest';
const TRANCO_TIER_COUNT: Record<TrancoTier, number> = {
  top1k: 1000,
  top10k: 10000,
  top100k: 100000
};

const TRANCO_FETCH_TIMEOUT = 60000; // 60秒
const TRANCO_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24時間

// Safety Mode と Tranco Tier のマッピング
export const SAFETY_MODE_TO_TRANCO_TIER: Record<SafetyMode, TrancoTier> = {
  strict: 'top1k',
  balanced: 'top10k',
  relaxed: 'top100k'
};

export const TRANCO_TIER_TO_SAFETY_MODE: Record<TrancoTier, SafetyMode> = {
  top1k: 'strict',
  top10k: 'balanced',
  top100k: 'relaxed'
};

// ===== Tranco Updater クラス =====

export class TrancoUpdater {
  private updateInProgress = false;

  /**
   * Tranco List を更新
   */
  async updateTrancoList(tier: TrancoTier): Promise<TrancoUpdateResult> {
    if (this.updateInProgress) {
      logWarn('Update already in progress', {}, undefined, 'TrancoUpdater');
      return {
        success: false,
        domainsCount: 0,
        sizeBytes: 0,
        error: 'Update already in progress'
      };
    }

    this.updateInProgress = true;
    const startTime = performance.now();

    try {
      logInfo('TrancoUpdater', { tier }, `Starting Tranco update for tier: ${tier}`);

      // 1. API から取得
      const domains = await this.fetchTrancoList(tier);
      logInfo('TrancoUpdater', { count: domains.length }, `Fetched ${domains.length} domains from Tranco`);

      // 2. データベースを更新
      const db = getTrustDb();
      await db.initialize();
      await db.updateTranco(domains, tier);

      const duration = performance.now() - startTime;
      logInfo('TrancoUpdater', { tier, count: domains.length, duration: duration.toFixed(0) }, `Tranco update completed in ${duration.toFixed(0)}ms`);

      return {
        success: true,
        domainsCount: domains.length,
        sizeBytes: domains.join('\n').length,
        duration
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logError('TrancoUpdater', { error: errorMessage }, ErrorCode.TRANCO_FETCH_FAILED);
      return {
        success: false,
        domainsCount: 0,
        sizeBytes: 0,
        error: errorMessage
      };
    } finally {
      this.updateInProgress = false;
    }
  }

  /**
   * Tranco API からデータを取得（最新リストID取得 → CSV ダウンロード）
   */
  private async fetchTrancoList(tier: TrancoTier): Promise<string[]> {
    // Step 1: 最新リストIDを取得
    logInfo('TrancoUpdater', {}, `Fetching latest Tranco list ID`);
    const metaResponse = await fetchWithTimeout(TRANCO_API_LATEST, { method: 'GET' }, TRANCO_FETCH_TIMEOUT);
    if (!metaResponse.ok) {
      throw new Error(`Tranco API returned status ${metaResponse.status}: ${metaResponse.statusText}`);
    }
    const meta = await metaResponse.json() as { list_id?: string; id?: string };
    const listId = meta.list_id ?? meta.id;
    if (!listId) {
      throw new Error('Tranco API response missing list_id');
    }

    // Step 2: CSV をダウンロード
    const count = TRANCO_TIER_COUNT[tier];
    const url = `https://tranco-list.eu/download/${listId}/${count}`;
    logInfo('TrancoUpdater', { url }, `Fetching CSV from: ${url}`);

    const response = await fetchWithTimeout(url, { method: 'GET' }, TRANCO_FETCH_TIMEOUT);
    if (!response.ok) {
      throw new Error(`Tranco CSV returned status ${response.status}: ${response.statusText}`);
    }

    const text = await response.text();
    const domains = this.parseTrancoCSV(text, tier);

    logInfo('TrancoUpdater', { tier, count: domains.length }, `Parsed ${domains.length} domains for tier: ${tier}`);

    return domains;
  }

  /**
   * Tranco CSV を解析
   */
  private parseTrancoCSV(csvText: string, tier: TrancoTier): string[] {
    const lines = csvText.trim().split('\n');
    const domains: string[] = [];

    // tier に基づいて制限を設定
    const limit = tier === 'top100k' ? 100000 : tier === 'top10k' ? 10000 : 1000;

    for (const line of lines) {
      // CSV 形式: rank,domain
      const [rank, domain] = line.split(',');
      if (domain && domains.length < limit) {
        domains.push(domain.trim().toLowerCase());
      }

      if (domains.length >= limit) {
        break;
      }
    }

    return domains;
  }

  /**
   * 更新中か確認
   */
  isUpdateInProgress(): boolean {
    return this.updateInProgress;
  }

  /**
   * Safety Mode から Tranco Tier を取得
   */
  safetyModeToTier(mode: SafetyMode): TrancoTier {
    return SAFETY_MODE_TO_TRANCO_TIER[mode];
  }

  /**
   * Tranco Tier から Safety Mode を取得
   */
  tierToSafetyMode(tier: TrancoTier): SafetyMode {
    return TRANCO_TIER_TO_SAFETY_MODE[tier];
  }

  /**
   * Tranco 更新が必要か確認
   */
  async isUpdateNeeded(tier: TrancoTier): Promise<boolean> {
    const db = getTrustDb();
    await db.initialize();

    const status = db.getStatus();

    if (!status.initialized || !status.lastUpdated) {
      return true; // 初回は必ず更新
    }

    const lastUpdated = new Date(status.lastUpdated);
    const now = new Date();
    const elapsed = now.getTime() - lastUpdated.getTime();

    return elapsed > TRANCO_UPDATE_INTERVAL_MS;
  }
}

// ===== シングルトンインスタンス =====

let trancoUpdaterInstance: TrancoUpdater | null = null;

export function getTrancoUpdater(): TrancoUpdater {
  if (!trancoUpdaterInstance) {
    trancoUpdaterInstance = new TrancoUpdater();
  }
  return trancoUpdaterInstance;
}