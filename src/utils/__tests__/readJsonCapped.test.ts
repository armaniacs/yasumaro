/**
 * readJsonCapped.test.ts — PBI 2026-11-08-09 (5)
 *
 * Pins that the byte cap also applies off the streaming path: a buffered
 * text() body and a json()-only double must both reject oversized payloads
 * instead of letting response.json() bypass the limit.
 */
import { describe, it, expect } from 'vitest';
import { readJsonCapped, ResponseBodyTooLargeError } from '../readBodyCapped.js';

function nonStreamResponse(jsonText: string): Response {
    return {
        body: null,
        text: async () => jsonText,
        json: async () => JSON.parse(jsonText),
    } as unknown as Response;
}

function jsonOnlyResponse(payload: unknown): Response {
    return {
        body: null,
        json: async () => payload,
    } as unknown as Response;
}

describe('readJsonCapped', () => {
    describe('non-streaming responses', () => {
        it('parses a small buffered body under the cap', async () => {
            const res = nonStreamResponse('{"hello":"world"}');
            await expect(readJsonCapped(res, 1024)).resolves.toEqual({ hello: 'world' });
        });

        it('rejects an oversized body read through text()', async () => {
            const res = nonStreamResponse(JSON.stringify({ data: 'x'.repeat(500) }));
            await expect(readJsonCapped(res, 32)).rejects.toBeInstanceOf(ResponseBodyTooLargeError);
        });

        it('rejects an oversized payload on json()-only doubles', async () => {
            const res = jsonOnlyResponse({ data: 'x'.repeat(500) });
            await expect(readJsonCapped(res, 32)).rejects.toBeInstanceOf(ResponseBodyTooLargeError);
        });

        it('accepts a small payload on json()-only doubles', async () => {
            const res = jsonOnlyResponse({ hello: 'world' });
            await expect(readJsonCapped(res, 1024)).resolves.toEqual({ hello: 'world' });
        });

        it('accepts a body exactly at the cap', async () => {
            const payload = { a: 1 };
            const exactBytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
            await expect(readJsonCapped(jsonOnlyResponse(payload), exactBytes)).resolves.toEqual(payload);
            await expect(readJsonCapped(nonStreamResponse(JSON.stringify(payload)), exactBytes)).resolves.toEqual(
                payload,
            );
        });
    });
});
