/**
 * messaging-types-uniformity.test.ts
 * Tests for messaging/types.ts payload type uniformity
 *
 * 対象問題: API-001 (inconsistent payload type definitions)
 * - `payload?: never` vs `payload: never` の不一致を修正
 * - 一貫した型定義の検証
 */

import { describe, test, expect } from '@jest/globals';

import {
  ServiceWorkerRequest,
  isServiceWorkerRequest,
  PayloadForType
} from '../messaging/types.js';

describe('Messaging Types Uniformity Tests', () => {
  test('CHECK_DOMAIN payload type should be never', () => {
    type Payload = PayloadForType<'CHECK_DOMAIN'>;
    // never型であることを確認 - 実際には何も代入できない
    const assertNever: never = 1 as Payload;
    // 型チェックのみ
    expect(true).toBe(true);
  });

  test('GET_CONTENT payload type should be never', () => {
    type Payload = PayloadForType<'GET_CONTENT'>;
    // never型であることを確認
    const assertNever: never = 1 as Payload;
    expect(true).toBe(true);
  });

  test('SAVE_RECORD payload type should be never', () => {
    type Payload = PayloadForType<'SAVE_RECORD'>;
    // never型であることを確認
    const assertNever: never = 1 as Payload;
    expect(true).toBe(true);
  });

  test('TEST_CONNECTIONS payload type should be never', () => {
    type Payload = PayloadForType<'TEST_CONNECTIONS'>;
    // never型であることを確認
    const assertNever: never = 1 as Payload;
    expect(true).toBe(true);
  });

  test('TEST_OBSIDIAN payload type should be never', () => {
    type Payload = PayloadForType<'TEST_OBSIDIAN'>;
    // never型であることを確認
    const assertNever: never = 1 as Payload;
    expect(true).toBe(true);
  });

  test('TEST_AI payload type should be never', () => {
    type Payload = PayloadForType<'TEST_AI'>;
    // never型であることを確認
    const assertNever: never = 1 as Payload;
    expect(true).toBe(true);
  });

  test('GET_PRIVACY_CACHE payload type should be never', () => {
    type Payload = PayloadForType<'GET_PRIVACY_CACHE'>;
    // never型であることを確認
    const assertNever: never = 1 as Payload;
    expect(true).toBe(true);
  });

  test('ACTIVITY_UPDATE payload type should be never', () => {
    type Payload = PayloadForType<'ACTIVITY_UPDATE'>;
    // never型であることを確認
    const assertNever: never = 1 as Payload;
    expect(true).toBe(true);
  });

  test('SESSION_LOCK_REQUEST payload type should be never', () => {
    type Payload = PayloadForType<'SESSION_LOCK_REQUEST'>;
    // never型であることを確認
    const assertNever: never = 1 as Payload;
    expect(true).toBe(true);
  });

  test('VALID_VISIT payload type should be { content: string }', () => {
    type Payload = PayloadForType<'VALID_VISIT'>;
    const payload: Payload = { content: 'test' };
    expect(payload.content).toBe('test');
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
    const validMessage: ServiceWorkerRequest = {
      type: 'CONTENT_CLEANSING_EXECUTED',
      payload: {
        hardStripRemoved: 10,
        keywordStripRemoved: 5,
        totalRemoved: 15
      }
    };

    expect(isServiceWorkerRequest(validMessage)).toBe(true);
  });

  test('all no-payload types accept undefined in type guard', () => {
    const noPayloadTypes = [
      'CHECK_DOMAIN',
      'GET_CONTENT',
      'SAVE_RECORD',
      'TEST_CONNECTIONS',
      'TEST_OBSIDIAN',
      'TEST_AI',
      'GET_PRIVACY_CACHE',
      'ACTIVITY_UPDATE',
      'SESSION_LOCK_REQUEST'
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