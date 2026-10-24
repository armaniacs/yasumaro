/**
 * sendRetryDefaults.ts — single home for messaging send/retry numbers.
 *
 * The dashboard hop, the sendWithPolicy seam, and the message transport each
 * grew their own retry numbers for their own failure universe (gateway-level
 * throw/retriable retry, seam-level inner retry pinned off to protect timeout
 * contracts, transport-level dead-port retry). Changing the timeout contract
 * meant editing every place at once, and a new sender had to decide which
 * numbers applied. This module owns every number so one edit propagates to
 * all gateways; the values below are the long-standing effective values,
 * moved here unchanged.
 */

export const DASHBOARD_SQLITE_TIMEOUT_MS = 10000;

export const DASHBOARD_SQLITE_TIMEOUT_MESSAGE = 'Dashboard SQLite request timed out';

export const DASHBOARD_GATEWAY_RETRY_ATTEMPTS = 1;

export const DASHBOARD_GATEWAY_RETRY_DELAY_MS = 1000;

export const DASHBOARD_GATEWAY_RETRY_MULTIPLIER = 1;

export const DASHBOARD_INNER_TRANSPORT_RETRIES = 0;

export const SEND_POLICY_DEFAULT_RETRIES = 0;

export const TRANSPORT_DEFAULT_RETRIES = 3;

export const TRANSPORT_RETRY_BASE_MS = 100;

export const TRANSPORT_RETRY_MULTIPLIER = 2;

export const TRANSPORT_RETRY_MAX_MS = 1000;

/**
 * Retry defaults table (PBI 2026-10-24-06): one row per seam so a policy
 * change touches exactly this module. Gateway behavior stays single-attempt
 * by default with a constant delay; the seam keeps inner retries off; the
 * transport keeps its dead-port retry series.
 */
export const SEND_RETRY_DEFAULTS = {
  dashboardTimeoutMs: DASHBOARD_SQLITE_TIMEOUT_MS,
  dashboardAttempts: DASHBOARD_GATEWAY_RETRY_ATTEMPTS,
  dashboardDelayMs: DASHBOARD_GATEWAY_RETRY_DELAY_MS,
  dashboardBackoffMultiplier: DASHBOARD_GATEWAY_RETRY_MULTIPLIER,
  dashboardInnerTransportRetries: DASHBOARD_INNER_TRANSPORT_RETRIES,
  sendPolicyRetries: SEND_POLICY_DEFAULT_RETRIES,
  transportRetries: TRANSPORT_DEFAULT_RETRIES,
  transportBackoffBaseMs: TRANSPORT_RETRY_BASE_MS,
  transportBackoffMultiplier: TRANSPORT_RETRY_MULTIPLIER,
  transportBackoffMaxMs: TRANSPORT_RETRY_MAX_MS,
} as const;
