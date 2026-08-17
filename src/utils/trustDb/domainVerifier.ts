/**
 * domainVerifier.ts
 * 3-Step Verification logic (JP-Anchor -> Sensitive -> Tranco), extracted
 * from trustDb.ts. Takes the relevant state as explicit params so it stays
 * testable without touching chrome.storage.
 */

import type { TrustResult, TrustDatabase } from './trustDbSchema.js';
import { DomainTrustLevel } from './trustDbSchema.js';
import type { TrustBloomFilter } from './bloomFilter.js';

export interface DomainVerifierState {
  database: TrustDatabase;
  bloomFilter: TrustBloomFilter;
  trancoSet: Set<string>;
  trancoRankMap: Map<string, number>;
}

export class DomainVerifier {
  /**
   * ドメインを信頼判定（3-Step Verification）
   */
  isDomainTrusted(domain: string, state: DomainVerifierState): TrustResult {
    // URL が渡された場合はホスト名を抽出する
    let normalizedDomain = domain.toLowerCase().trim();
    if (normalizedDomain.startsWith('http://') || normalizedDomain.startsWith('https://')) {
      try {
        normalizedDomain = new URL(normalizedDomain).hostname;
      } catch {
        // パース失敗はそのまま使用
      }
    }

    // Step 1: JP-Anchor TLD 判定
    const anchorResult = this.checkJpAnchor(normalizedDomain, state);
    if (anchorResult.level === DomainTrustLevel.TRUSTED) {
      return anchorResult;
    }

    // Step 2: Sensitive List 判定
    const sensitiveResult = this.checkSensitive(normalizedDomain, state);
    if (sensitiveResult.level === DomainTrustLevel.SENSITIVE) {
      return sensitiveResult;
    }

    // Step 3: Tranco 判定
    const trancoResult = this.checkTranco(normalizedDomain, state);
    if (trancoResult.level === DomainTrustLevel.TRUSTED) {
      return trancoResult;
    }

    return {
      level: DomainTrustLevel.UNVERIFIED,
      source: 'unknown',
      reason: 'Domain not in any trusted list'
    };
  }

  /**
   * Step 1: JP-Anchor TLD 判定
   */
  checkJpAnchor(domain: string, state: DomainVerifierState): TrustResult {
    const allTlds = [
      ...state.database.jpAnchor.tlds,
      ...state.database.jpAnchor.userTlds
    ];

    for (const tld of allTlds) {
      if (domain.endsWith(tld)) {
        return {
          level: DomainTrustLevel.TRUSTED,
          source: 'jp-anchor',
          reason: `Domain ends with ${tld}`,
          category: 'anchor'
        };
      }
    }

    return { level: DomainTrustLevel.UNVERIFIED, source: 'unknown', reason: 'Not a JP-Anchor domain' };
  }

  /**
   * Step 2: Sensitive List 判定
   */
  checkSensitive(domain: string, state: DomainVerifierState): TrustResult {
    const db = state.database;

    // ホワイトリスト優先
    if (db.sensitive.whitelist.includes(domain)) {
      return {
        level: DomainTrustLevel.TRUSTED,
        source: 'whitelist',
        reason: 'Domain is in user whitelist',
        category: 'unknown'
      };
    }

    // ユーザー追加ブラックリスト
    if (db.sensitive.userBlacklist.includes(domain)) {
      return {
        level: DomainTrustLevel.SENSITIVE,
        source: 'user-blacklist',
        reason: 'Domain is in user blacklist',
        category: 'unknown'
      };
    }

    // Bloom Filter でチェック（偽陽性の可能性あり）
    if (!state.bloomFilter.mightContain(domain)) {
      return { level: DomainTrustLevel.UNVERIFIED, source: 'unknown', reason: 'Not in sensitive list' };
    }

    // 精密照合（偽陽性チェック）
    const financeCheck = this.checkCategory(domain, db.sensitive.presets.finance, 'finance');
    if (financeCheck) return financeCheck;

    const gamingCheck = this.checkCategory(domain, db.sensitive.presets.gaming, 'gaming');
    if (gamingCheck) return gamingCheck;

    const snsCheck = this.checkCategory(domain, db.sensitive.presets.sns, 'sns');
    if (snsCheck) return snsCheck;

    // Bloom Filter 偽陽性
    return { level: DomainTrustLevel.UNVERIFIED, source: 'unknown', reason: 'Bloom filter false positive' };
  }

  /**
   * カテゴリ固有のチェック
   */
  private checkCategory(
    domain: string,
    list: string[],
    category: 'finance' | 'gaming' | 'sns'
  ): TrustResult | null {
    if (list.includes(domain)) {
      return {
        level: DomainTrustLevel.SENSITIVE,
        source: 'sensitive-presets',
        reason: `Domain is in ${category} sensitive list`,
        category
      };
    }
    return null;
  }

  /**
   * Step 3: Tranco 判定
   * 最適化: キャッシュされたSet を使用して O(1) 検索
   */
  checkTranco(domain: string, state: DomainVerifierState): TrustResult {
    const db = state.database;

    if (db.tranco.domains.length === 0) {
      return { level: DomainTrustLevel.UNVERIFIED, source: 'unknown', reason: 'Tranco list is empty' };
    }

    // サブドメインを除いた候補リストを生成 (例: edition.cnn.com → [edition.cnn.com, cnn.com])
    // 【修正】2部ドメインでも正しくサブドメイン除去を行えるようループ条件を修正
    const candidates: string[] = [domain];
    const parts = domain.split('.');
    // 少なくとも1ラベル（TLDは除く）残すようにする
    for (let i = 1; i < parts.length; i++) {
      const candidate = parts.slice(i).join('.');
      // TLDのみにならないようにチェック（ドットを含むことを確認）
      if (candidate.includes('.')) {
        candidates.push(candidate);
      }
    }

    // キャッシュされたSetを使用 (O(1) 検索)
    const trancoSet = state.trancoSet;

    for (const candidate of candidates) {
      // Bloom Filter でチェック
      if (!state.bloomFilter.mightContain(candidate)) {
        continue;
      }

      // 精密照合 (Set.has は O(1))
      if (trancoSet.has(candidate)) {
        // インデックスを取得 (rank 報告用) - O(1) マップ検索
        const index = state.trancoRankMap.get(candidate)!;
        return {
          level: DomainTrustLevel.TRUSTED,
          source: 'tranco',
          reason: `Domain is in Tranco top ${db.tranco.tier} at rank ${index + 1}`,
          category: 'tranco'
        };
      }
    }

    return { level: DomainTrustLevel.UNVERIFIED, source: 'unknown', reason: 'Not in Tranco list' };
  }
}
