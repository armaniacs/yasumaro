import type { LogEntry } from './types.js';

/**
 * In-memory ring buffer for pending log entries.
 * Pure (no chrome dependency) so it can be unit-tested directly.
 */
export class LogBuffer {
  private entries: LogEntry[] = [];

  constructor(private readonly capacity: number) {}

  push(entry: LogEntry): void {
    if (this.entries.length >= this.capacity) {
      // slice(1) drops the oldest; avoids in-place shift
      this.entries = this.entries.slice(1);
    }
    this.entries.push(entry);
  }

  drain(): LogEntry[] {
    const out = this.entries;
    this.entries = [];
    return out;
  }

  size(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries = [];
  }

  /** Return a shallow copy of buffered entries without draining. */
  peek(): LogEntry[] {
    return [...this.entries];
  }
}
