import { describe, expect, it } from 'vitest';
import {
  getTransportRetryPolicy,
  RETRY_SAFE,
  RETRY_UNCONFIGURED,
  RETRY_UNSAFE,
  shouldRetryTransport,
} from '../transportRetryPolicy.js';
import { SQLITE_WIRE_TABLE, SQLITE_MAINTAIN_WIRE_TABLE } from '../sqliteWireTable.js';
import { ARCHIVE_WIRE_TABLE } from '../archiveWireTable.js';

type PolicyRoute = { op: string; messageType: string; retryPolicy: string };

const routes: PolicyRoute[] = [
  ...SQLITE_WIRE_TABLE.map((entry) => ({ op: entry.op, messageType: entry.messageType, retryPolicy: entry.retryPolicy })),
  ...SQLITE_MAINTAIN_WIRE_TABLE.map((entry) => ({ op: entry.op, messageType: entry.messageType, retryPolicy: entry.retryPolicy })),
  ...ARCHIVE_WIRE_TABLE.map((entry) => ({ op: entry.op, messageType: entry.messageType, retryPolicy: entry.retryPolicy })),
  { op: 'getStatus', messageType: 'SQLITE_STATUS', retryPolicy: getTransportRetryPolicy('SQLITE_STATUS') },
];

const EXPECTED_RETRY_SAFE = [
  'SQLITE_UPDATE',
  'SQLITE_DELETE',
  'SQLITE_QUERY',
  'SQLITE_AUDIT_LOG_QUERY',
  'SQLITE_COUNT',
  'SQLITE_STATUS',
  'SQLITE_INIT',
  'SQLITE_BACKUP',
  'SQLITE_CLEAR_ALL',
  'SQLITE_HEALTH_CHECK',
  'SQLITE_ARCHIVE_PREVIEW',
  'SQLITE_ARCHIVE_CLEANUP',
  'SQLITE_ARCHIVE_EXPORT',
  'SQLITE_ARCHIVE_RESTORE_PREVIEW',
  'SQLITE_ARCHIVE_QUERY',
  'SQLITE_ARCHIVE_UPDATE',
  'SQLITE_ARCHIVE_STATUS',
] as const;

const EXPECTED_RETRY_UNSAFE = [
  'SQLITE_INSERT',
  'SQLITE_INSERT_BATCH',
  'SQLITE_TOGGLE_STAR',
  'SQLITE_AUDIT_LOG_INSERT',
  'SQLITE_RESTORE',
  'SQLITE_PURGE',
  'CONTENT_PURGE',
  'SQLITE_ARCHIVE_CREATE',
  'SQLITE_ARCHIVE_PREPARE_INCOMING',
  'SQLITE_ARCHIVE_RESTORE',
  'SQLITE_ARCHIVE_DELETE_BY_STAGING',
  'SQLITE_ARCHIVE_OPEN',
  'SQLITE_ARCHIVE_SAVE',
  'SQLITE_ARCHIVE_CLOSE',
] as const;

describe('messaging transport retry policy', () => {
  it('classifies all 32 wire operations without an unconfigured policy', () => {
    expect(routes).toHaveLength(32);
    expect(routes.filter((route) => route.retryPolicy === RETRY_SAFE)).toHaveLength(18);
    expect(routes.filter((route) => route.retryPolicy === RETRY_UNSAFE)).toHaveLength(14);
    expect(routes.every((route) => route.retryPolicy !== RETRY_UNCONFIGURED)).toBe(true);
    for (const route of routes) {
      expect(route.retryPolicy).toBe(getTransportRetryPolicy(route.messageType));
    }
  });

  it('matches the explicit safe and unsafe message contract', () => {
    expect(EXPECTED_RETRY_SAFE).toHaveLength(17);
    expect(EXPECTED_RETRY_UNSAFE).toHaveLength(14);
    for (const type of EXPECTED_RETRY_SAFE) {
      expect(getTransportRetryPolicy(type)).toBe(RETRY_SAFE);
    }
    for (const type of EXPECTED_RETRY_UNSAFE) {
      expect(getTransportRetryPolicy(type)).toBe(RETRY_UNSAFE);
    }
  });

  it('keeps insert and insertBatch retry-unsafe', () => {
    expect(getTransportRetryPolicy('SQLITE_INSERT')).toBe(RETRY_UNSAFE);
    expect(getTransportRetryPolicy('SQLITE_INSERT_BATCH')).toBe(RETRY_UNSAFE);
  });

  it('marks audit log insertion and non-idempotent lifecycle operations retry-unsafe', () => {
    expect(getTransportRetryPolicy('SQLITE_AUDIT_LOG_INSERT')).toBe(RETRY_UNSAFE);
    expect(getTransportRetryPolicy('SQLITE_TOGGLE_STAR')).toBe(RETRY_UNSAFE);
    expect(getTransportRetryPolicy('SQLITE_RESTORE')).toBe(RETRY_UNSAFE);
    expect(getTransportRetryPolicy('SQLITE_PURGE')).toBe(RETRY_UNSAFE);
    expect(getTransportRetryPolicy('CONTENT_PURGE')).toBe(RETRY_UNSAFE);
    expect(getTransportRetryPolicy('SQLITE_ARCHIVE_PREPARE_INCOMING')).toBe(RETRY_UNSAFE);
  });

  it('keeps read and explicitly idempotent maintenance operations retry-safe', () => {
    for (const type of [
      'SQLITE_QUERY',
      'SQLITE_AUDIT_LOG_QUERY',
      'SQLITE_COUNT',
      'SQLITE_STATUS',
      'SQLITE_INIT',
      'SQLITE_BACKUP',
      'SQLITE_CLEAR_ALL',
      'SQLITE_HEALTH_CHECK',
    ]) {
      expect(getTransportRetryPolicy(type)).toBe(RETRY_SAFE);
    }
  });

  it('does not retry unknown message types and honors explicit noRetry', () => {
    for (const type of ['SQLITE_FUTURE_OPERATION', 'SQLITE_SEARCH', 'SQLITE_EXPORT']) {
      expect(getTransportRetryPolicy(type)).toBe(RETRY_UNCONFIGURED);
      expect(shouldRetryTransport(type)).toBe(false);
    }
    expect(shouldRetryTransport('SQLITE_INSERT')).toBe(false);
    expect(shouldRetryTransport('SQLITE_INSERT', { noRetry: false })).toBe(false);
    expect(shouldRetryTransport('SQLITE_AUDIT_LOG_INSERT', { noRetry: false })).toBe(false);
  });
});
