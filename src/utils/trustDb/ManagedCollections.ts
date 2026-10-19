/**
 * ManagedCollections.ts
 * Single module bundling userTlds / sensitive / whitelist ManagedStringLists.
 * Replaces WhitelistStore + SensitiveDomainStore shallow wrappers.
 * ManagedStringList remains internal implementation.
 */

import type { TrustDatabase } from './trustDbSchema.js';
import type { TrustDbListOp } from './mergeTrustDatabase.js';
import { ManagedStringList } from './managedStringList.js';
import { isValidDomain, isValidTld } from './domainValidation.js';

export class ManagedCollections {
  readonly userTlds: ManagedStringList;
  readonly sensitive: ManagedStringList;
  readonly whitelist: ManagedStringList;

  constructor(
    private readonly database: TrustDatabase,
    save: () => Promise<void>,
    onOp?: (op: TrustDbListOp) => void
  ) {
    const db = database;
    // Per-list intent recorder: forwards add/remove operations to the kernel's
    // pending-ops queue so the CAS merge can apply them to the stored base.
    const recordFor = (
      list: TrustDbListOp['list']
    ): ((kind: 'add' | 'remove', item: string) => void) | undefined =>
      onOp
        ? (kind, item) => {
            onOp({ list, kind, item });
          }
        : undefined;

    this.userTlds = new ManagedStringList(db.jpAnchor.userTlds, {
      save,
      recordOp: recordFor('userTlds'),
      duplicateErrorMessage: 'TLD already exists',
      notFoundErrorMessage: 'TLD not found',
      normalize: (tld) => (tld.startsWith('.') ? tld : '.' + tld),
      validate: (tld) => {
        if (!isValidTld(tld)) {
          return {
            valid: false,
            error:
              'Invalid TLD format. TLD must contain only letters, numbers, and hyphens, must start/end with a letter or number, and be 2-63 characters long (e.g., .com, .jp, .ai)',
          };
        }
        if (db.jpAnchor.tlds.includes(tld)) {
          return { valid: false, error: 'TLD already exists' };
        }
        return { valid: true };
      },
    });

    this.sensitive = new ManagedStringList(db.sensitive.userBlacklist, {
      save,
      recordOp: recordFor('userBlacklist'),
      normalize: (domain) => domain.toLowerCase().trim(),
      validate: (domain) => {
        if (!isValidDomain(domain)) {
          return {
            valid: false,
            error:
              'Invalid domain format. Domain must follow RFC standards: contain only letters, numbers, hyphens, and dots, start/end with letter or number, and be max 253 characters long',
          };
        }
        return { valid: true };
      },
    });

    this.whitelist = new ManagedStringList(db.sensitive.whitelist, {
      save,
      recordOp: recordFor('whitelist'),
      normalize: (domain) => domain.toLowerCase().trim(),
      validate: (domain) => {
        if (!isValidDomain(domain)) {
          return {
            valid: false,
            error:
              'Invalid domain format. Domain must follow RFC standards: contain only letters, numbers, hyphens, and dots, start/end with letter or number, and be max 253 characters long',
          };
        }
        return { valid: true };
      },
    });
  }

  // ---- JP-Anchor ----
  getJpAnchorTlds(): string[] {
    return [...this.database.jpAnchor.tlds, ...this.database.jpAnchor.userTlds];
  }

  async addUserTld(tld: string): Promise<{ success: boolean; error?: string }> {
    return this.userTlds.add(tld);
  }

  async removeUserTld(tld: string): Promise<{ success: boolean; error?: string }> {
    return this.userTlds.remove(tld);
  }

  async addJpAnchorTld(tld: string): Promise<{ success: boolean; error?: string }> {
    return this.addUserTld(tld);
  }

  async removeJpAnchorTld(tld: string): Promise<{ success: boolean; error?: string }> {
    return this.removeUserTld(tld);
  }

  // ---- Sensitive ----
  getSensitiveDomains(category: 'finance' | 'gaming' | 'sns'): string[] {
    return [...this.database.sensitive.presets[category], ...this.sensitive.getAll()];
  }

  async addSensitiveDomain(domain: string): Promise<{ success: boolean; error?: string }> {
    return this.sensitive.add(domain);
  }

  async removeSensitiveDomain(domain: string): Promise<{ success: boolean; error?: string }> {
    return this.sensitive.remove(domain);
  }

  // ---- Whitelist ----
  getWhitelist(): string[] {
    return this.whitelist.getAll();
  }

  async addToWhitelist(domain: string): Promise<{ success: boolean; error?: string }> {
    return this.whitelist.add(domain);
  }

  async removeFromWhitelist(domain: string): Promise<{ success: boolean; error?: string }> {
    return this.whitelist.remove(domain);
  }
}
