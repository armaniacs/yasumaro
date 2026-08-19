/**
 * messaging/sqliteValidators.ts
 * Pure validation helpers for SQLite responses.
 * Extracted from dashboardSqliteService.ts (PBI-05) so Dashboard and SW can share one validator module.
 * No chrome API dependency — importable from any context.
 */

import type { BrowsingLogEntry } from '../utils/sqlite-types.js';

export function requiredFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid SQLite response: ${field}`);
  }
  return value;
}

export function requiredNonNegativeNumber(value: unknown, field: string): number {
  const n = requiredFiniteNumber(value, field);
  if (n < 0) throw new Error(`Invalid SQLite response: ${field}`);
  return n;
}

export function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid SQLite response: ${field}`);
  return value;
}

export function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid SQLite response: ${field}`);
  return value;
}

export function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  return requiredBoolean(value, field);
}

export function optionalNullableString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  return requiredString(value, field);
}

export function optionalNonNegativeNumber(value: unknown, field: string): number {
  if (value === undefined || value === null) return 0;
  return requiredNonNegativeNumber(value, field);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function requiredRows<T>(value: unknown, field: string, isRow: (value: unknown) => value is T): T[] {
  if (!Array.isArray(value) || !value.every(isRow)) {
    throw new Error(`Invalid SQLite response: ${field}`);
  }
  return value;
}

export function isBrowsingLogEntry(value: unknown): value is BrowsingLogEntry {
  return isRecord(value) && isFiniteNumber((value as Record<string, unknown>).id) && typeof (value as Record<string, unknown>).url === 'string' && isFiniteNumber((value as Record<string, unknown>).created_at);
}

export type AuditLogEntryView = { id: number; provider: string; url: string; created_at: number };

export function isAuditLogEntry(value: unknown): value is AuditLogEntryView {
  return isRecord(value) && isFiniteNumber((value as Record<string, unknown>).id) && typeof (value as Record<string, unknown>).provider === 'string' && typeof (value as Record<string, unknown>).url === 'string' && isFiniteNumber((value as Record<string, unknown>).created_at);
}

export function requiredStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
    throw new Error(`Invalid SQLite response: ${field}`);
  }
  return value;
}

export function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  return requiredStringArray(value, field);
}

export type CompileOptionsSource = 'opfs-worker' | 'idb' | 'fallback';

export function optionalCompileOptionsSource(value: unknown): CompileOptionsSource | undefined {
  if (value === undefined) return undefined;
  if (value === 'opfs-worker' || value === 'idb' || value === 'fallback') return value;
  throw new Error('Invalid SQLite response: compileOptionsSource');
}

export function decodeOpfsSpikeReport(value: unknown): import('../offscreen/opfsSpike.js').OpfsSpikeReport {
  if (!isRecord(value)) throw new Error('Invalid SQLite response: report');
  return value as unknown as import('../offscreen/opfsSpike.js').OpfsSpikeReport;
}
