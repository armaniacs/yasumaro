import type { SqliteMessageType } from './sqliteMessages.js';

export const RETRY_SAFE = 'retry-safe' as const;
export const RETRY_UNSAFE = 'retry-unsafe' as const;
export const RETRY_UNCONFIGURED = 'unconfigured' as const;

export type TransportRetryPolicy =
  | typeof RETRY_SAFE
  | typeof RETRY_UNSAFE
  | typeof RETRY_UNCONFIGURED;

export interface TransportRetryOptions {
  noRetry?: boolean;
}

type TransportMessageType = SqliteMessageType;

const RETRY_POLICY_ENTRIES: ReadonlyArray<readonly [TransportMessageType, TransportRetryPolicy]> = [
  // A lost response does not prove that a write failed, and the backends do
  // not share a duplicate-insert or batch-progress recovery contract.
  ['SQLITE_INSERT', RETRY_UNSAFE],
  ['SQLITE_INSERT_BATCH', RETRY_UNSAFE],
  ['SQLITE_UPDATE', RETRY_SAFE],
  ['SQLITE_DELETE', RETRY_SAFE],
  ['SQLITE_TOGGLE_STAR', RETRY_UNSAFE],
  ['SQLITE_AUDIT_LOG_INSERT', RETRY_UNSAFE],
  ['SQLITE_QUERY', RETRY_SAFE],
  ['SQLITE_AUDIT_LOG_QUERY', RETRY_SAFE],
  ['SQLITE_COUNT', RETRY_SAFE],
  ['SQLITE_STATUS', RETRY_SAFE],
  ['SQLITE_INIT', RETRY_SAFE],
  ['SQLITE_BACKUP', RETRY_SAFE],
  ['SQLITE_RESTORE', RETRY_UNSAFE],
  ['SQLITE_CLEAR_ALL', RETRY_SAFE],
  ['SQLITE_PURGE', RETRY_UNSAFE],
  ['CONTENT_PURGE', RETRY_UNSAFE],
  ['SQLITE_HEALTH_CHECK', RETRY_SAFE],
  ['SQLITE_ARCHIVE_PREVIEW', RETRY_SAFE],
  ['SQLITE_ARCHIVE_CREATE', RETRY_UNSAFE],
  ['SQLITE_ARCHIVE_CLEANUP', RETRY_SAFE],
  ['SQLITE_ARCHIVE_EXPORT', RETRY_SAFE],
  ['SQLITE_ARCHIVE_PREPARE_INCOMING', RETRY_UNSAFE],
  ['SQLITE_ARCHIVE_RESTORE_PREVIEW', RETRY_SAFE],
  ['SQLITE_ARCHIVE_RESTORE', RETRY_UNSAFE],
  ['SQLITE_ARCHIVE_DELETE_BY_STAGING', RETRY_UNSAFE],
  ['SQLITE_ARCHIVE_OPEN', RETRY_UNSAFE],
  ['SQLITE_ARCHIVE_QUERY', RETRY_SAFE],
  ['SQLITE_ARCHIVE_UPDATE', RETRY_SAFE],
  ['SQLITE_ARCHIVE_SAVE', RETRY_UNSAFE],
  ['SQLITE_ARCHIVE_CLOSE', RETRY_UNSAFE],
  ['SQLITE_ARCHIVE_STATUS', RETRY_SAFE],
];

export const TRANSPORT_RETRY_POLICIES: ReadonlyMap<string, TransportRetryPolicy> = new Map(RETRY_POLICY_ENTRIES);

export function getTransportRetryPolicy(messageType: string): TransportRetryPolicy {
  return TRANSPORT_RETRY_POLICIES.get(messageType) ?? RETRY_UNCONFIGURED;
}

export function shouldRetryTransport(
  messageType: string,
  options: TransportRetryOptions = {},
): boolean {
  return options.noRetry !== true && getTransportRetryPolicy(messageType) === RETRY_SAFE;
}
