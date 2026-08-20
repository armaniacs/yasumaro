// @layer 0 — Foundation: pure validation, no chrome dependencies
/**
 * messaging/validators.ts
 * Unified MessageValidator interface + concrete validators for 3 domains.
 *
 * PBI 2026-08-23-03: MessageValidator<T> defines a single seam for
 * validating unknown messages. Handlers receive already-validated payloads.
 */

import { isServiceWorkerRequest } from './types.js';
import type {
  ExtensionMessage,
  ValidVisitMessage,
  FetchUrlMessage,
  ManualRecordMessage,
  ContentCleansingExecutedMessage,
} from '../background/messageTypes.js';
import type { DashboardSqliteRequest } from '../background/handlers/dashboardSqliteProtocol.js';
import { ALL_DASHBOARD_SQLITE_SUBTYPES } from './sqliteOperationSecurity.js';

export class ValidationError extends Error {
  constructor(
    public readonly validatorName: string,
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export interface MessageValidator<T> {
  validate(msg: unknown): T;
}

// ------------------------------------------------------------------
// ServiceWorkerRequestValidator — generic ExtensionMessage validation
// ------------------------------------------------------------------
export class ServiceWorkerRequestValidator implements MessageValidator<ExtensionMessage> {
  validate(msg: unknown): ExtensionMessage {
    if (!isServiceWorkerRequest(msg)) {
      throw new ValidationError('ServiceWorkerRequestValidator', 'Invalid message format', 'type');
    }
    return msg as ExtensionMessage;
  }
}

// ------------------------------------------------------------------
// ValidVisitValidator — VALID_VISIT payload validation
// ------------------------------------------------------------------
export class ValidVisitValidator implements MessageValidator<ValidVisitMessage> {
  validate(msg: unknown): ValidVisitMessage {
    if (!msg || typeof msg !== 'object') {
      throw new ValidationError('ValidVisitValidator', 'Message must be an object');
    }
    const m = msg as Record<string, unknown>;
    if (m.type !== 'VALID_VISIT') {
      throw new ValidationError('ValidVisitValidator', 'type must be VALID_VISIT', 'type');
    }
    if (!m.payload || typeof m.payload !== 'object') {
      throw new ValidationError('ValidVisitValidator', 'payload is required', 'payload');
    }
    const payload = m.payload as Record<string, unknown>;
    if (typeof payload.content !== 'string') {
      throw new ValidationError('ValidVisitValidator', 'payload.content must be a string', 'content');
    }
    if (payload.content.length === 0) {
      throw new ValidationError('ValidVisitValidator', 'payload.content must not be empty', 'content');
    }
    if (payload.force !== undefined && typeof payload.force !== 'boolean') {
      throw new ValidationError('ValidVisitValidator', 'payload.force must be boolean', 'force');
    }
    // VALID_MESSAGE_TYPES check already ensures type is known, but verify protocolVersion if present
    if ('protocolVersion' in m && typeof m.protocolVersion !== 'number') {
      throw new ValidationError('ValidVisitValidator', 'protocolVersion must be a number', 'protocolVersion');
    }
    return msg as ValidVisitMessage;
  }
}

// ------------------------------------------------------------------
// DashboardSqliteValidator — DASHBOARD_SQLITE payload validation
// ------------------------------------------------------------------
export class DashboardSqliteValidator implements MessageValidator<DashboardSqliteRequest> {
  validate(msg: unknown): DashboardSqliteRequest {
    if (!msg || typeof msg !== 'object') {
      throw new ValidationError('DashboardSqliteValidator', 'Message must be an object');
    }
    const m = msg as Record<string, unknown>;
    // If the caller passes the full ExtensionMessage, unwrap payload
    const payload: unknown = (m.payload !== undefined ? m.payload : m) as unknown;
    if (!payload || typeof payload !== 'object') {
      throw new ValidationError('DashboardSqliteValidator', 'payload must be an object', 'payload');
    }
    const p = payload as Record<string, unknown>;
    if (typeof p.subtype !== 'string') {
      throw new ValidationError('DashboardSqliteValidator', 'subtype is required', 'subtype');
    }
    if (!(ALL_DASHBOARD_SQLITE_SUBTYPES as readonly string[]).includes(p.subtype)) {
      throw new ValidationError('DashboardSqliteValidator', `Unknown subtype: ${p.subtype}`, 'subtype');
    }
    const subtype = p.subtype as DashboardSqliteRequest['subtype'];

    // Per-subtype required field checks (minimal, to enforce schema)
    if (subtype === 'toggle_star' || subtype === 'delete') {
      if (typeof p.id !== 'number' || !Number.isFinite(p.id)) {
        throw new ValidationError('DashboardSqliteValidator', `${subtype}: id must be finite number`, 'id');
      }
    }
    if (subtype === 'update') {
      if (typeof p.id !== 'number' || !Number.isFinite(p.id)) {
        throw new ValidationError('DashboardSqliteValidator', 'update: id must be finite number', 'id');
      }
      if (!p.changes || typeof p.changes !== 'object') {
        throw new ValidationError('DashboardSqliteValidator', 'update: changes is required', 'changes');
      }
    }
    if (subtype === 'search') {
      if (typeof p.query !== 'string') {
        throw new ValidationError('DashboardSqliteValidator', 'search: query must be string', 'query');
      }
    }
    if (subtype === 'import') {
      if (!Array.isArray(p.rows)) {
        throw new ValidationError('DashboardSqliteValidator', 'import: rows must be array', 'rows');
      }
    }
    if (subtype === 'restore_db') {
      if (typeof p.data !== 'string') {
        throw new ValidationError('DashboardSqliteValidator', 'restore_db: data must be string', 'data');
      }
    }
    if (subtype === 'append_to_obsidian') {
      if (!Array.isArray(p.ids)) {
        throw new ValidationError('DashboardSqliteValidator', 'append_to_obsidian: ids must be array', 'ids');
      }
    }

    return payload as DashboardSqliteRequest;
  }
}

// ------------------------------------------------------------------
// FetchUrlValidator — FETCH_URL payload validation
// ------------------------------------------------------------------
export class FetchUrlValidator implements MessageValidator<FetchUrlMessage> {
  validate(msg: unknown): FetchUrlMessage {
    if (!msg || typeof msg !== 'object') {
      throw new ValidationError('FetchUrlValidator', 'Message must be an object');
    }
    const m = msg as Record<string, unknown>;
    if (m.type !== 'FETCH_URL') {
      throw new ValidationError('FetchUrlValidator', 'type must be FETCH_URL', 'type');
    }
    if (!m.payload || typeof m.payload !== 'object') {
      throw new ValidationError('FetchUrlValidator', 'payload is required', 'payload');
    }
    const payload = m.payload as Record<string, unknown>;
    if (typeof payload.url !== 'string' || payload.url.length === 0) {
      throw new ValidationError('FetchUrlValidator', 'payload.url must be non-empty string', 'url');
    }
    // Basic URL shape check — detailed SSRF is handled by ssrfGuard downstream
    try {
      const parsed = new URL(payload.url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new ValidationError('FetchUrlValidator', 'payload.url must be http or https', 'url');
      }
    } catch (e) {
      if (e instanceof ValidationError) throw e;
      throw new ValidationError('FetchUrlValidator', 'payload.url must be valid URL', 'url');
    }
    if ('protocolVersion' in m && typeof m.protocolVersion !== 'number') {
      throw new ValidationError('FetchUrlValidator', 'protocolVersion must be a number', 'protocolVersion');
    }
    return msg as FetchUrlMessage;
  }
}

// ------------------------------------------------------------------
// ManualRecordValidator — MANUAL_RECORD / PREVIEW_RECORD / SAVE_RECORD payload validation
// ------------------------------------------------------------------
export class ManualRecordValidator implements MessageValidator<ManualRecordMessage> {
  validate(msg: unknown): ManualRecordMessage {
    if (!msg || typeof msg !== 'object') {
      throw new ValidationError('ManualRecordValidator', 'Message must be an object');
    }
    const m = msg as Record<string, unknown>;
    const allowedTypes = ['MANUAL_RECORD', 'PREVIEW_RECORD', 'SAVE_RECORD'];
    if (typeof m.type !== 'string' || !allowedTypes.includes(m.type as string)) {
      throw new ValidationError('ManualRecordValidator', 'type must be MANUAL_RECORD/PREVIEW_RECORD/SAVE_RECORD', 'type');
    }
    if (!m.payload || typeof m.payload !== 'object') {
      throw new ValidationError('ManualRecordValidator', 'payload is required', 'payload');
    }
    const payload = m.payload as Record<string, unknown>;
    if (typeof payload.title !== 'string') {
      throw new ValidationError('ManualRecordValidator', 'payload.title must be string', 'title');
    }
    if (typeof payload.url !== 'string' || payload.url.length === 0) {
      throw new ValidationError('ManualRecordValidator', 'payload.url must be non-empty string', 'url');
    }
    if (typeof payload.content !== 'string') {
      throw new ValidationError('ManualRecordValidator', 'payload.content must be string', 'content');
    }
    if (payload.force !== undefined && typeof payload.force !== 'boolean') {
      throw new ValidationError('ManualRecordValidator', 'payload.force must be boolean', 'force');
    }
    return msg as ManualRecordMessage;
  }
}

// ------------------------------------------------------------------
// CheckDomainValidator — CHECK_DOMAIN (no payload, content-script allowed)
// ------------------------------------------------------------------
export class CheckDomainValidator implements MessageValidator<ExtensionMessage> {
  validate(msg: unknown): ExtensionMessage {
    if (!msg || typeof msg !== 'object') {
      throw new ValidationError('CheckDomainValidator', 'Message must be an object');
    }
    const m = msg as Record<string, unknown>;
    if (m.type !== 'CHECK_DOMAIN') {
      throw new ValidationError('CheckDomainValidator', 'type must be CHECK_DOMAIN', 'type');
    }
    // CHECK_DOMAIN must not have payload (NO_PAYLOAD_TYPES), but tolerate undefined
    if (m.payload !== undefined) {
      throw new ValidationError('CheckDomainValidator', 'CHECK_DOMAIN must not have payload', 'payload');
    }
    return msg as ExtensionMessage;
  }
}

// ------------------------------------------------------------------
// ContentCleansingExecutedValidator — CONTENT_CLEANSING_EXECUTED
// ------------------------------------------------------------------
export class ContentCleansingExecutedValidator implements MessageValidator<ContentCleansingExecutedMessage> {
  validate(msg: unknown): ContentCleansingExecutedMessage {
    if (!msg || typeof msg !== 'object') {
      throw new ValidationError('ContentCleansingExecutedValidator', 'Message must be an object');
    }
    const m = msg as Record<string, unknown>;
    if (m.type !== 'CONTENT_CLEANSING_EXECUTED') {
      throw new ValidationError('ContentCleansingExecutedValidator', 'type must be CONTENT_CLEANSING_EXECUTED', 'type');
    }
    if (!m.payload || typeof m.payload !== 'object') {
      throw new ValidationError('ContentCleansingExecutedValidator', 'payload is required', 'payload');
    }
    const p = m.payload as Record<string, unknown>;
    for (const field of ['hardStripRemoved', 'keywordStripRemoved', 'totalRemoved'] as const) {
      if (typeof p[field] !== 'number' || !Number.isFinite(p[field])) {
        throw new ValidationError('ContentCleansingExecutedValidator', `payload.${field} must be finite number`, field);
      }
    }
    return msg as ContentCleansingExecutedMessage;
  }
}

// Convenience singletons for registry wiring
export const serviceWorkerRequestValidator = new ServiceWorkerRequestValidator();
export const validVisitValidator = new ValidVisitValidator();
export const dashboardSqliteValidator = new DashboardSqliteValidator();
export const fetchUrlValidator = new FetchUrlValidator();
export const manualRecordValidator = new ManualRecordValidator();
export const checkDomainValidator = new CheckDomainValidator();
export const contentCleansingExecutedValidator = new ContentCleansingExecutedValidator();
