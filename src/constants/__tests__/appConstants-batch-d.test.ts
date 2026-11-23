/**
 * appConstants-batch-d.test.ts — PBI 2026-11-08-16 (item 4) pins.
 *
 * TIMEOUTS exposes the gateway/hop budgets as aliases of the single
 * sendRetryDefaults definitions instead of re-stating the numbers.
 * Behavior is unchanged: the values below are the long-standing ones.
 */
import { describe, it, expect } from 'vitest';
import { TIMEOUTS } from '../appConstants.js';
import {
  AI_GATEWAY_TIMEOUT_MS,
  DASHBOARD_SQLITE_TIMEOUT_MS,
  RECORD_GATEWAY_TIMEOUT_MS,
} from '../../messaging/sendRetryDefaults.js';

describe('TIMEOUTS gateway budget aliases (PBI 2026-11-08-16 item 4)', () => {
  it('aliases the single sendRetryDefaults definitions', () => {
    expect(TIMEOUTS.GATEWAY_RECORD).toBe(RECORD_GATEWAY_TIMEOUT_MS);
    expect(TIMEOUTS.GATEWAY_AI).toBe(AI_GATEWAY_TIMEOUT_MS);
    expect(TIMEOUTS.DASHBOARD_SQLITE).toBe(DASHBOARD_SQLITE_TIMEOUT_MS);
  });

  it('keeps the long-standing budget values', () => {
    expect(TIMEOUTS.GATEWAY_RECORD).toBe(20000);
    expect(TIMEOUTS.GATEWAY_AI).toBe(60000);
    expect(TIMEOUTS.DASHBOARD_SQLITE).toBe(10000);
  });

  it('leaves the pre-existing timeout entries untouched', () => {
    expect(TIMEOUTS.CONTENT_SCRIPT).toBe(5000);
    expect(TIMEOUTS.AI_PROCESSING).toBe(30000);
    expect(TIMEOUTS.SESSION_TIMEOUT).toBe(24 * 60 * 60 * 1000);
  });
});
