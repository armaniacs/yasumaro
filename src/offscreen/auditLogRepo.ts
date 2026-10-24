/**
 * auditLogRepo.ts
 * Backward-compatible re-export shim (PBI: fold thin delegation trio).
 *
 * The audit_log operations now live in the single SQLite secondary-store
 * module (recordsRepo.ts). This file re-exports them so existing importers
 * keep working with unchanged results.
 */

export * from './recordsRepo.js';
