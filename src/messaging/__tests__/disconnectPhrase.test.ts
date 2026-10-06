/**
 * disconnectPhrase.test.ts — 切断文言 SSOT 判定 (PBI 2026-10-05-23)。
 *
 * isDisconnectMessage が旧3箇所の和集合に一致すること:
 * sqliteRpcClient の大文字表記と regenerateContentFetcher の小文字表記は
 * どちらも真になり、分類自体は呼び出し側に残る (ここでは判定のみ検証)。
 */
import { describe, it, expect } from 'vitest';
import { DISCONNECT_PHRASES, isDisconnectMessage } from '../disconnectPhrase.js';

/** Chrome が切断済み相手への sendMessage に返す原文。 */
const CHROME_DISCONNECTED = 'Could not establish connection. Receiving end does not exist.';

describe('isDisconnectMessage', () => {
  it('matches Chrome exact disconnect wording', () => {
    expect(isDisconnectMessage(CHROME_DISCONNECTED)).toBe(true);
  });

  it('matches each phrase on its own', () => {
    expect(isDisconnectMessage('Receiving end does not exist.')).toBe(true);
    expect(isDisconnectMessage('Could not establish connection.')).toBe(true);
  });

  it('matches regardless of case (old call sites split upper/lower)', () => {
    expect(isDisconnectMessage('The receiving end does not exist.')).toBe(true);
    expect(isDisconnectMessage('could not establish connection')).toBe(true);
    expect(isDisconnectMessage('RECEIVING END DOES NOT EXIST')).toBe(true);
  });

  it('rejects unrelated failures (classification stays with callers)', () => {
    expect(isDisconnectMessage('offscreen document was closed')).toBe(false);
    expect(isDisconnectMessage('QuotaExceededError')).toBe(false);
    expect(isDisconnectMessage('SQLITE_BUSY')).toBe(false);
    expect(isDisconnectMessage('Extension context invalidated')).toBe(false);
    expect(isDisconnectMessage('something nobody predicted')).toBe(false);
  });

  it('exposes the shared phrase table', () => {
    expect(DISCONNECT_PHRASES).toContain('Receiving end does not exist');
    expect(DISCONNECT_PHRASES).toContain('Could not establish connection');
  });
});
