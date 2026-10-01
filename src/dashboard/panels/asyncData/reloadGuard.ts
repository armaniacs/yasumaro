/**
 * ReloadGuard centralizes the bump-before-await / compare-after-await race
 * guard that the outer reload ring, the history model, and the navigation
 * registry each hand-rolled. One module owns the counter; consumers share a
 * guard instance via injection so "which load wins" has a single home.
 */
export type LoadToken = number;

export class ReloadGuard {
  private seq = 0;

  /**
   * Starts a load and returns its token. Any previously issued token becomes
   * stale.
   */
  start(): LoadToken {
    this.seq += 1;
    return this.seq;
  }

  /** Discards in-flight loads without starting a new one. */
  invalidate(): void {
    this.seq += 1;
  }

  isCurrent(token: LoadToken): boolean {
    return token === this.seq;
  }
}
