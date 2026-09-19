import { describe, it, expect } from 'vitest';
import { validateObsidianProtocol, isLoopbackHost, validateObsidianHost } from '../obsidianConfigValidator.js';

describe('isLoopbackHost', () => {
    it.each(['localhost', 'LOCALHOST', '127.0.0.1', '::1', '[::1]', ' localhost '])('treats %s as loopback', (h) => {
        expect(isLoopbackHost(h)).toBe(true);
    });
    it.each(['192.168.1.10', 'example.com', '10.0.0.1'])('treats %s as non-loopback', (h) => {
        expect(isLoopbackHost(h)).toBe(false);
    });
});

describe('validateObsidianProtocol non-loopback HTTP', () => {
    it('rejects http to a LAN host', () => {
        expect(() => validateObsidianProtocol('http', '192.168.1.10')).toThrow(/non-loopback/);
    });
    it('allows http to loopback hosts', () => {
        expect(validateObsidianProtocol('http', '127.0.0.1')).toBe('http');
        expect(validateObsidianProtocol('http', 'localhost')).toBe('http');
    });
    it('allows http with no host given (defaults to loopback)', () => {
        expect(validateObsidianProtocol('http')).toBe('http');
    });
    it('allows https to any host', () => {
        expect(validateObsidianProtocol('https', '192.168.1.10')).toBe('https');
    });
});

describe('validateObsidianHost userinfo bypass', () => {
    it.each([
        '127.0.0.1@evil.com',
        'localhost@evil.com',
        'evil.com%2Fpath',
        '%2e%2e',
    ])('rejects %s (URL userinfo/percent tricks redirect the API key elsewhere)', (h) => {
        expect(() => validateObsidianHost(h)).toThrow(/invalid characters/);
    });
    it('still accepts plain hostnames, IPv4, and IPv6', () => {
        expect(validateObsidianHost('example.com')).toBe('example.com');
        expect(validateObsidianHost('192.168.1.10')).toBe('192.168.1.10');
        expect(validateObsidianHost('::1')).toBe('[::1]');
    });
});
