/**
 * messaging-types-uniformity.test.ts
 * Tests for messaging/types.ts payload type uniformity
 *
 * 対象問題: API-001 (inconsistent payload type definitions)
 * - `payload?: never` vs `payload: never` の不一致を修正
 * - 一貫した型定義の検証
 */



import {
  isServiceWorkerRequest,
  PayloadForType
} from '../messaging/types.js';
import type { ExtensionMessage } from '../background/messageTypes.js';
import { NO_PAYLOAD_TYPES } from '../background/messageTypes.js';

describe('Messaging Types Uniformity Tests', () => {
  test('CHECK_DOMAIN has never payload — bare envelope passes guard, any payload is rejected', () => {
    type Payload = PayloadForType<'CHECK_DOMAIN'>;
    // Compile-time check: Payload must be never (a number literal only casts to never cleanly).
    const assertNever: never = 1 as Payload;
    expect(assertNever).toBe(1);
    // Runtime contract: registered as no-payload, bare envelope validates, any payload rejected.
    expect(NO_PAYLOAD_TYPES).toContain('CHECK_DOMAIN');
    expect(isServiceWorkerRequest({ type: 'CHECK_DOMAIN' })).toBe(true);
    expect(isServiceWorkerRequest({ type: 'CHECK_DOMAIN', payload: undefined })).toBe(true);
    expect(Object.keys({ type: 'CHECK_DOMAIN' })).toEqual(['type']);
    expect(isServiceWorkerRequest({ type: 'CHECK_DOMAIN', payload: {} })).toBe(false);
  });

  test('GET_CONTENT has never payload — bare envelope passes guard, any payload is rejected', () => {
    type Payload = PayloadForType<'GET_CONTENT'>;
    // Compile-time check: Payload must be never.
    const assertNever: never = 1 as Payload;
    expect(assertNever).toBe(1);
    // Runtime contract: registered as no-payload, bare envelope validates, any payload rejected.
    expect(NO_PAYLOAD_TYPES).toContain('GET_CONTENT');
    expect(isServiceWorkerRequest({ type: 'GET_CONTENT' })).toBe(true);
    expect(isServiceWorkerRequest({ type: 'GET_CONTENT', payload: undefined })).toBe(true);
    expect(Object.keys({ type: 'GET_CONTENT' })).toEqual(['type']);
    expect(isServiceWorkerRequest({ type: 'GET_CONTENT', payload: {} })).toBe(false);
  });

  test('SAVE_RECORD payload type should include required fields', () => {
    type Payload = PayloadForType<'SAVE_RECORD'>;
    const payload: Payload = {
      title: 'Test',
      url: 'https://example.com',
      content: 'Content'
    };
    expect(payload.title).toBe('Test');
    expect(payload.url).toBe('https://example.com');
    expect(payload.content).toBe('Content');
  });

  test('TEST_CONNECTIONS has never payload — bare envelope passes guard, any payload is rejected', () => {
    type Payload = PayloadForType<'TEST_CONNECTIONS'>;
    // Compile-time check: Payload must be never.
    const assertNever: never = 1 as Payload;
    expect(assertNever).toBe(1);
    // Runtime contract: registered as no-payload, bare envelope validates, any payload rejected.
    expect(NO_PAYLOAD_TYPES).toContain('TEST_CONNECTIONS');
    expect(isServiceWorkerRequest({ type: 'TEST_CONNECTIONS' })).toBe(true);
    expect(isServiceWorkerRequest({ type: 'TEST_CONNECTIONS', payload: undefined })).toBe(true);
    expect(Object.keys({ type: 'TEST_CONNECTIONS' })).toEqual(['type']);
    expect(isServiceWorkerRequest({ type: 'TEST_CONNECTIONS', payload: {} })).toBe(false);
  });

  test('TEST_AI has never payload — bare envelope passes guard, any payload is rejected', () => {
    type Payload = PayloadForType<'TEST_AI'>;
    // Compile-time check: Payload must be never (runId lives beside payload, not inside it).
    const assertNever: never = 1 as Payload;
    expect(assertNever).toBe(1);
    // Runtime contract: registered as no-payload, bare envelope validates, any payload rejected.
    expect(NO_PAYLOAD_TYPES).toContain('TEST_AI');
    expect(isServiceWorkerRequest({ type: 'TEST_AI' })).toBe(true);
    expect(isServiceWorkerRequest({ type: 'TEST_AI', payload: undefined })).toBe(true);
    expect(Object.keys({ type: 'TEST_AI' })).toEqual(['type']);
    expect(isServiceWorkerRequest({ type: 'TEST_AI', payload: {} })).toBe(false);
  });

  test('GET_PRIVACY_CACHE has never payload — bare envelope passes guard, any payload is rejected', () => {
    type Payload = PayloadForType<'GET_PRIVACY_CACHE'>;
    // Compile-time check: Payload must be never.
    const assertNever: never = 1 as Payload;
    expect(assertNever).toBe(1);
    // Runtime contract: registered as no-payload, bare envelope validates, any payload rejected.
    expect(NO_PAYLOAD_TYPES).toContain('GET_PRIVACY_CACHE');
    expect(isServiceWorkerRequest({ type: 'GET_PRIVACY_CACHE' })).toBe(true);
    expect(isServiceWorkerRequest({ type: 'GET_PRIVACY_CACHE', payload: undefined })).toBe(true);
    expect(Object.keys({ type: 'GET_PRIVACY_CACHE' })).toEqual(['type']);
    expect(isServiceWorkerRequest({ type: 'GET_PRIVACY_CACHE', payload: {} })).toBe(false);
  });

  test('ACTIVITY_UPDATE payload type reflects its optional empty-object payload', () => {
    type Payload = PayloadForType<'ACTIVITY_UPDATE'>;
    // ActivityUpdateMessage は payload?: Record<string, never> を持つため、
    // PayloadForType は Record<string, never> に解決される（never ではない）。
    // なお isServiceWorkerRequest / NO_PAYLOAD_TYPES は ACTIVITY_UPDATE を
    // no-payload 扱いする（payload === undefined を要求）が、本番は payload: {}
    // を直送りする経路がある。この不整合の解消は本 PBI スコープ外（別 PBI）。
    const payload: Payload = {};
    expect(payload).toEqual({});
  });

  test('SESSION_LOCK_REQUEST has never payload — bare envelope passes guard, any payload is rejected', () => {
    type Payload = PayloadForType<'SESSION_LOCK_REQUEST'>;
    // Compile-time check: Payload must be never.
    const assertNever: never = 1 as Payload;
    expect(assertNever).toBe(1);
    // Runtime contract: registered as no-payload, bare envelope validates, any payload rejected.
    expect(NO_PAYLOAD_TYPES).toContain('SESSION_LOCK_REQUEST');
    expect(isServiceWorkerRequest({ type: 'SESSION_LOCK_REQUEST' })).toBe(true);
    expect(isServiceWorkerRequest({ type: 'SESSION_LOCK_REQUEST', payload: undefined })).toBe(true);
    expect(Object.keys({ type: 'SESSION_LOCK_REQUEST' })).toEqual(['type']);
    expect(isServiceWorkerRequest({ type: 'SESSION_LOCK_REQUEST', payload: {} })).toBe(false);
  });

  test('PING has never payload — bare envelope passes guard, any payload is rejected', () => {
    type Payload = PayloadForType<'PING'>;
    // Compile-time check: Payload must be never.
    const assertNever: never = 1 as Payload;
    expect(assertNever).toBe(1);
    // Runtime contract: registered as no-payload, bare envelope validates, any payload rejected.
    expect(NO_PAYLOAD_TYPES).toContain('PING');
    expect(isServiceWorkerRequest({ type: 'PING' })).toBe(true);
    expect(isServiceWorkerRequest({ type: 'PING', payload: undefined })).toBe(true);
    expect(Object.keys({ type: 'PING' })).toEqual(['type']);
    expect(isServiceWorkerRequest({ type: 'PING', payload: {} })).toBe(false);
  });

  test('REFRESH_LOCAL_MARKDOWN_SCHEDULER has never payload — bare envelope passes guard, any payload is rejected', () => {
    type Payload = PayloadForType<'REFRESH_LOCAL_MARKDOWN_SCHEDULER'>;
    // Compile-time check: Payload must be never.
    const assertNever: never = 1 as Payload;
    expect(assertNever).toBe(1);
    // Runtime contract: registered as no-payload, bare envelope validates, any payload rejected.
    expect(NO_PAYLOAD_TYPES).toContain('REFRESH_LOCAL_MARKDOWN_SCHEDULER');
    expect(isServiceWorkerRequest({ type: 'REFRESH_LOCAL_MARKDOWN_SCHEDULER' })).toBe(true);
    expect(isServiceWorkerRequest({ type: 'REFRESH_LOCAL_MARKDOWN_SCHEDULER', payload: undefined })).toBe(true);
    expect(Object.keys({ type: 'REFRESH_LOCAL_MARKDOWN_SCHEDULER' })).toEqual(['type']);
    expect(isServiceWorkerRequest({ type: 'REFRESH_LOCAL_MARKDOWN_SCHEDULER', payload: {} })).toBe(false);
  });

  test('CONSENT_STATE_CHANGED has never payload — bare envelope passes guard, any payload is rejected', () => {
    type Payload = PayloadForType<'CONSENT_STATE_CHANGED'>;
    // Compile-time check: Payload must be never.
    const assertNever: never = 1 as Payload;
    expect(assertNever).toBe(1);
    // Runtime contract: registered as no-payload, bare envelope validates, any payload rejected.
    expect(NO_PAYLOAD_TYPES).toContain('CONSENT_STATE_CHANGED');
    expect(isServiceWorkerRequest({ type: 'CONSENT_STATE_CHANGED' })).toBe(true);
    expect(isServiceWorkerRequest({ type: 'CONSENT_STATE_CHANGED', payload: undefined })).toBe(true);
    expect(Object.keys({ type: 'CONSENT_STATE_CHANGED' })).toEqual(['type']);
    expect(isServiceWorkerRequest({ type: 'CONSENT_STATE_CHANGED', payload: {} })).toBe(false);
  });

  test('TEST_OBSIDIAN payload type should allow optional apiKey', () => {
    type Payload = PayloadForType<'TEST_OBSIDIAN'>;
    const withKey: Payload = { apiKey: 'secret' };
    const withoutKey: Payload = {};
    expect(withKey.apiKey).toBe('secret');
    expect(withoutKey.apiKey).toBeUndefined();
  });

  test('GENERATE_REVIEW_SUMMARY payload type should include periodType', () => {
    type Payload = PayloadForType<'GENERATE_REVIEW_SUMMARY'>;
    const payload: Payload = { periodType: 'weekly' };
    expect(payload.periodType).toBe('weekly');
  });

  test('DASHBOARD_SQLITE payload type should allow optional object', () => {
    type Payload = PayloadForType<'DASHBOARD_SQLITE'>;
    const minimal: Payload = { subtype: 'get_count' };
    const query: Payload = { subtype: 'query', limit: 10 };
    expect(minimal.subtype).toBe('get_count');
    expect(query.subtype).toBe('query');
  });

  test('VALID_VISIT payload type should be { content: string }', () => {
    type Payload = PayloadForType<'VALID_VISIT'>;
    const payload: Payload = { content: 'test' };
    expect(payload.content).toBe('test');
  });

  test('VALID_VISIT payload accepts byte tracking fields', () => {
    type Payload = PayloadForType<'VALID_VISIT'>;
    const payloadWithBytes = {
      content: 'test',
      pageBytes: 1024,
      candidateBytes: 512,
      originalBytes: 400,
      cleansedBytes: 350,
      aiSummaryOriginalBytes: 300,
      aiSummaryCleansedBytes: 250,
      aiSummaryCleansedElements: 3,
      aiSummaryCleansedReason: 'keyword_match'
    } as unknown as Payload & Record<string, unknown>;
    expect(payloadWithBytes.content).toBe('test');
    expect(payloadWithBytes.pageBytes).toBe(1024);
    expect(payloadWithBytes.cleansedBytes).toBe(350);
  });

  test('sendFromPopup with no-payload type should not include payload field', () => {
    // sendFromPopup はno-payloadタイプで payload: {} を付与するバグを修正済み
    // isServiceWorkerRequest は no-payload タイプで msg.payload === undefined を必須とするため
    // payload: {} があるとバリデーション失敗する
    const noPayloadMessage = { type: 'TEST_CONNECTIONS' };
    expect(isServiceWorkerRequest(noPayloadMessage)).toBe(true);

    const withEmptyPayload = { type: 'TEST_CONNECTIONS', payload: {} } as any;
    expect(isServiceWorkerRequest(withEmptyPayload)).toBe(false);
  });

  test('MANUAL_RECORD payload type should include required fields', () => {
    type Payload = PayloadForType<'MANUAL_RECORD'>;
    const payload: Payload = {
      title: 'Test',
      url: 'https://example.com',
      content: 'Content',
      skipAi: true
    };
    expect(payload.title).toBe('Test');
    expect(payload.url).toBe('https://example.com');
    expect(payload.content).toBe('Content');
    expect(payload.skipAi).toBe(true);
  });

  test('isServiceWorkerRequest requires object payload for VALID_VISIT', () => {
    const invalidMessage = {
      type: 'VALID_VISIT',
      payload: undefined
    } as any;

    expect(isServiceWorkerRequest(invalidMessage)).toBe(false);
  });

  test('isServiceWorkerRequest accepts undefined payload for CHECK_DOMAIN', () => {
    const messageWithUndefined = {
      type: 'CHECK_DOMAIN',
      payload: undefined
    };

    expect(isServiceWorkerRequest(messageWithUndefined)).toBe(true);
  });

  test('isServiceWorkerRequest rejects string payload for CHECK_DOMAIN', () => {
    const invalidMessage = {
      type: 'CHECK_DOMAIN',
      payload: 'invalid'
    } as any;

    expect(isServiceWorkerRequest(invalidMessage)).toBe(false);
  });

  test('isServiceWorkerRequest handles CONTENT_CLEANSING_EXECUTED with valid payload', () => {
    const validMessage = {
      type: 'CONTENT_CLEANSING_EXECUTED',
      payload: {
        hardStripRemoved: 10,
        keywordStripRemoved: 5,
        totalRemoved: 15
      }
    } as unknown as ExtensionMessage;

    expect(isServiceWorkerRequest(validMessage)).toBe(true);
  });

  test('isServiceWorkerRequest accepts missing or object payload for TEST_OBSIDIAN', () => {
    expect(isServiceWorkerRequest({ type: 'TEST_OBSIDIAN' })).toBe(true);
    expect(isServiceWorkerRequest({ type: 'TEST_OBSIDIAN', payload: undefined })).toBe(true);
    expect(isServiceWorkerRequest({ type: 'TEST_OBSIDIAN', payload: { apiKey: 'x' } })).toBe(true);
    expect(isServiceWorkerRequest({ type: 'TEST_OBSIDIAN', payload: 'secret' })).toBe(false);
  });

  test('isServiceWorkerRequest accepts missing or object payload for DASHBOARD_SQLITE', () => {
    expect(isServiceWorkerRequest({ type: 'DASHBOARD_SQLITE' })).toBe(true);
    expect(isServiceWorkerRequest({ type: 'DASHBOARD_SQLITE', payload: undefined })).toBe(true);
    expect(isServiceWorkerRequest({ type: 'DASHBOARD_SQLITE', payload: { subtype: 'get_count' } })).toBe(true);
  });

  test('all no-payload types accept undefined in type guard', () => {
    const noPayloadTypes = [
      'CHECK_DOMAIN',
      'GET_CONTENT',
      'TEST_CONNECTIONS',
      'TEST_AI',
      'GET_PRIVACY_CACHE',
      'ACTIVITY_UPDATE',
      'SESSION_LOCK_REQUEST',
      'PING',
      'REFRESH_LOCAL_MARKDOWN_SCHEDULER',
      'CONSENT_STATE_CHANGED'
    ] as const;

    noPayloadTypes.forEach(type => {
      const message = {
        type,
        payload: undefined
      };
      expect(isServiceWorkerRequest(message)).toBe(true);
    });
  });
});