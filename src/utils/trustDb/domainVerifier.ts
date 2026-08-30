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
   *
   * 5 Whys 分析 (PBI-27):
   * 1. Why 誤信頼? `domain.endsWith(tld)` のみで判定し `myexamplecom` が `.com` / `example.com` に誤マッチ
   * 2. Why ドット境界なし? TLD を `example.com` 形式で保存している前提で完全一致とサブドメイン一致を区別しなかった
   * 3. Why 気づかず? テストが `sub.example.com` の正当サブドメインのみで `evil-example.com` 境界違反を未カバー
   * 4. Why テスト漏れ? セキュリティ境界(attacker suffix) のテスト観点がレビューチェックリストに無かった
   * 5. Why プロセス漏れ? 検証時(verification time)に TLD 形式バリデーション(`isValidTld`)が無く、不正 TLD(`*`, 空文字)が判定に参加できた
   * 解: `domain === tld || domain.endsWith("." + tld)` + `isValidTld` で除外
   */
  checkJpAnchor(domain: string, state: DomainVerifierState): TrustResult {
    const jpAnchor = state.database?.jpAnchor;
    if (!jpAnchor) return { level: DomainTrustLevel.UNVERIFIED, source: 'unknown', reason: 'Trust DB not initialized' };
    const allTlds = [
      ...jpAnchor.tlds,
      ...jpAnchor.userTlds
    ];

    const normalizedDomain = domain.toLowerCase().trim();

    for (const tld of allTlds) {
      if (!this.isValidTld(tld)) continue;
      const normalizedTld = tld.toLowerCase().trim().replace(/^\./, '');
      if (normalizedDomain === normalizedTld || normalizedDomain.endsWith('.' + normalizedTld)) {
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
   * TLD 形式バリデーション (PBI-27)
   * - 空文字 / "*" / ワイルドカード含みを除外
   * - 先頭ドットは許容し除去して検証 (".go.jp" -> "go.jp")
   * - RFC ラベル準拠: 各ラベル 1-63 文字、英数字/ハイフン、ハイフンで開始/終了しない
   * - 複数ラベル (例: "go.jp", "example.com") を許容
   */
  private isValidTld(tld: string): boolean {
    const trimmed = tld.trim();
    if (!trimmed) return false;
    if (trimmed.includes('*')) return false;
    const normalized = trimmed.startsWith('.') ? trimmed.slice(1) : trimmed;
    if (!normalized) return false;
    if (normalized.length < 2) return false;
    if (normalized.length > 253) return false;
    if (normalized.startsWith('.') || normalized.endsWith('.')) return false;
    if (normalized.includes('..')) return false;
    const labels = normalized.split('.');
    const labelRegex = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
    for (const label of labels) {
      if (!label || label.length === 0 || label.length > 63) return false;
      if (!labelRegex.test(label)) return false;
    }
    return true;
  }

  /**
   * Step 2: Sensitive List 判定
   */
  checkSensitive(domain: string, state: DomainVerifierState): TrustResult {
    const db = state.database;
    if (!db || !db.sensitive) return { level: DomainTrustLevel.UNVERIFIED, source: 'unknown', reason: 'Trust DB not initialized' };

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
    if (!db || !db.tranco) return { level: DomainTrustLevel.UNVERIFIED, source: 'unknown', reason: 'Trust DB not initialized' };

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
