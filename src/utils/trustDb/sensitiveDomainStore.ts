/**
 * sensitiveDomainStore.ts
 * Thin wrapper around the sensitive.userBlacklist ManagedStringList plus
 * read access to the presets embedded in the database, extracted from
 * trustDb.ts.
 */

import type { ManagedStringList } from './managedStringList.js';

export interface SensitiveDomainsPresets {
  finance: string[];
  gaming: string[];
  sns: string[];
}

export class SensitiveDomainStore {
  constructor(
    private readonly list: ManagedStringList,
    private readonly getPresets: () => SensitiveDomainsPresets
  ) {}

  /**
   * Sensitive ドメインリストを取得（カテゴリ指定）
   */
  getSensitiveDomains(category: 'finance' | 'gaming' | 'sns'): string[] {
    return [...this.getPresets()[category], ...this.list.getAll()];
  }

  /**
   * Sensitive ドメインを追加
   */
  async addSensitiveDomain(domain: string): Promise<{ success: boolean; error?: string }> {
    return this.list.add(domain);
  }

  /**
   * Sensitive ドメインを削除
   */
  async removeSensitiveDomain(domain: string): Promise<{ success: boolean; error?: string }> {
    return this.list.remove(domain);
  }
}
