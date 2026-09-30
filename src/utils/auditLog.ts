/**
 * auditLog.ts — @deprecated re-export shim.
 *
 * The audit gateway reads the shared SQLite client, so it lives in
 * src/messaging/auditLogGateway.ts. This module only forwards, so importers
 * (and the vi.mock paths their tests register) keep resolving while the utils →
 * background edge stays gone. New code must import the gateway directly.
 */

export { recordAuditLog, getAuditLogs, type AuditLogEntry } from '../messaging/auditLogGateway.js';
