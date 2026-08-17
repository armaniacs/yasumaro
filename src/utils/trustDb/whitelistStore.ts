/**
 * whitelistStore.ts
 * Thin wrapper around the sensitive.whitelist ManagedStringList, extracted
 * from trustDb.ts.
 */

import type { ManagedStringList } from './managedStringList.js';

export class WhitelistStore {
  constructor(private readonly list: ManagedStringList) {}

  /**
   * Whitelist を取得
   */
  getWhitelist(): string[] {
    return this.list.getAll();
  }

  /**
   * Whitelist にドメインを追加
   */
  async addToWhitelist(domain: string): Promise<{ success: boolean; error?: string }> {
    return this.list.add(domain);
  }

  /**
   * Whitelist からドメインを削除
   */
  async removeFromWhitelist(domain: string): Promise<{ success: boolean; error?: string }> {
    return this.list.remove(domain);
  }
}
