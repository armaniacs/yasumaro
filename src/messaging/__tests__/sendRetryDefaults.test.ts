/**
 * sendRetryDefaults.test.ts — retry table pin (PBI 2026-10-24-06).
 *
 * The dashboard hop, the sendWithPolicy seam, and the message transport used
 * to own their retry numbers separately. This test pins that the single
 * defaults module carries the long-standing effective values unchanged, so a
 * future policy change touches exactly that module and propagates to all
 * gateways. No timers run here: pure value assertions, no real-time waits.
 */
import { describe, it, expect } from 'vitest';
import {
  DASHBOARD_GATEWAY_RETRY_ATTEMPTS,
  DASHBOARD_GATEWAY_RETRY_DELAY_MS,
  DASHBOARD_GATEWAY_RETRY_MULTIPLIER,
  DASHBOARD_INNER_TRANSPORT_RETRIES,
  DASHBOARD_SQLITE_TIMEOUT_MESSAGE,
  DASHBOARD_SQLITE_TIMEOUT_MS,
  SEND_POLICY_DEFAULT_RETRIES,
  SEND_RETRY_DEFAULTS,
  TRANSPORT_DEFAULT_RETRIES,
  TRANSPORT_RETRY_BASE_MS,
  TRANSPORT_RETRY_MAX_MS,
  TRANSPORT_RETRY_MULTIPLIER,
} from '../sendRetryDefaults.js';

describe('sendRetryDefaults — single retry table (PBI 2026-10-24-06)', () => {
  it('keeps the dashboard hop budget and gateway retry effective values', () => {
    expect(DASHBOARD_SQLITE_TIMEOUT_MS).toBe(10000);
    expect(DASHBOARD_SQLITE_TIMEOUT_MESSAGE).toBe('Dashboard SQLite request timed out');
    expect(DASHBOARD_GATEWAY_RETRY_ATTEMPTS).toBe(1);
    expect(DASHBOARD_GATEWAY_RETRY_DELAY_MS).toBe(1000);
    expect(DASHBOARD_GATEWAY_RETRY_MULTIPLIER).toBe(1);
    expect(DASHBOARD_INNER_TRANSPORT_RETRIES).toBe(0);
  });

  it('keeps the seam and transport retry effective values', () => {
    expect(SEND_POLICY_DEFAULT_RETRIES).toBe(0);
    expect(TRANSPORT_DEFAULT_RETRIES).toBe(3);
    expect(TRANSPORT_RETRY_BASE_MS).toBe(100);
    expect(TRANSPORT_RETRY_MULTIPLIER).toBe(2);
    expect(TRANSPORT_RETRY_MAX_MS).toBe(1000);
  });

  it('exposes every default through one table object', () => {
    expect(SEND_RETRY_DEFAULTS).toEqual({
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
    });
  });
});
