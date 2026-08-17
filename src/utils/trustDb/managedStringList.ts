/**
 * managedStringList.ts
 * Generic add/remove/getAll wrapper over an array-backed string list, with
 * optional per-item validation and normalization. Extracted from trustDb.ts
 * to collapse the userTlds/sensitive.userBlacklist/sensitive.whitelist CRUD
 * pairs into one reusable implementation.
 */

export interface ManagedStringListOptions {
  /** Validate (and optionally reject) an item before it is added. */
  validate?: (item: string) => { valid: boolean; error?: string };
  /** Normalize an item before comparison/storage (e.g. lowercase, add a leading dot). */
  normalize?: (item: string) => string;
  /** Persist the owning database after a successful add/remove. */
  save: () => Promise<void>;
  /** Error message when the (normalized) item is already present. Defaults to 'Domain already exists'. */
  duplicateErrorMessage?: string;
  /** Error message when the item to remove is not present. Defaults to 'Domain not found'. */
  notFoundErrorMessage?: string;
}

export class ManagedStringList {
  constructor(
    private readonly items: string[],
    private readonly options: ManagedStringListOptions,
  ) {}

  async add(item: string): Promise<{ success: boolean; error?: string }> {
    const normalized = this.options.normalize ? this.options.normalize(item) : item;

    if (this.options.validate) {
      const result = this.options.validate(normalized);
      if (!result.valid) {
        return { success: false, error: result.error };
      }
    }

    if (this.items.includes(normalized)) {
      return { success: false, error: this.options.duplicateErrorMessage ?? 'Domain already exists' };
    }

    this.items.push(normalized);
    await this.options.save();
    return { success: true };
  }

  async remove(item: string): Promise<{ success: boolean; error?: string }> {
    const index = this.items.indexOf(item);
    if (index === -1) {
      return { success: false, error: this.options.notFoundErrorMessage ?? 'Domain not found' };
    }

    this.items.splice(index, 1);
    await this.options.save();
    return { success: true };
  }

  getAll(): string[] {
    return [...this.items];
  }
}
