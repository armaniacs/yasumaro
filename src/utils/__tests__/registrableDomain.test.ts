/**
 * registrableDomain.test.ts
 * Unit tests for eTLD+1 derivation (heuristic + minimal multi-label list).
 */
import { describe, it, expect } from 'vitest';

import { getRegistrableDomain } from '../registrableDomain.js';

describe('getRegistrableDomain', () => {
  it('collapses sibling subdomains to the same registrable domain', () => {
    expect(getRegistrableDomain('a.example.com')).toBe('example.com');
    expect(getRegistrableDomain('b.example.com')).toBe('example.com');
    expect(getRegistrableDomain('deep.nested.example.com')).toBe('example.com');
  });

  it('returns the bare registrable domain unchanged', () => {
    expect(getRegistrableDomain('example.com')).toBe('example.com');
  });

  it('is case-insensitive and tolerates a trailing dot', () => {
    expect(getRegistrableDomain('A.Example.COM')).toBe('example.com');
    expect(getRegistrableDomain('a.example.com.')).toBe('example.com');
  });

  it.each([
    ['www.example.co.uk', 'example.co.uk'],
    ['a.b.example.co.jp', 'example.co.jp'],
    ['shop.example.com.au', 'example.com.au'],
    ['www.example.org.uk', 'example.org.uk'],
    ['www.example.ne.jp', 'example.ne.jp'],
    ['www.example.or.jp', 'example.or.jp'],
    ['www.example.ac.uk', 'example.ac.uk'],
    ['www.example.gov.uk', 'example.gov.uk'],
    ['www.example.co.nz', 'example.co.nz'],
  ])('derives eTLD+1 through multi-label suffix %s -> %s', (host, expected) => {
    expect(getRegistrableDomain(host)).toBe(expected);
  });

  it('returns the suffix itself when the host is the suffix', () => {
    expect(getRegistrableDomain('co.uk')).toBe('co.uk');
  });

  it('falls back to the last two labels for unknown suffixes', () => {
    expect(getRegistrableDomain('a.b.foo.bar')).toBe('foo.bar');
  });

  it('returns null for localhost and localhost subdomains', () => {
    expect(getRegistrableDomain('localhost')).toBeNull();
    expect(getRegistrableDomain('app.localhost')).toBeNull();
  });

  it('returns null for IPv4 and IPv6 literals', () => {
    expect(getRegistrableDomain('127.0.0.1')).toBeNull();
    expect(getRegistrableDomain('192.168.1.10')).toBeNull();
    expect(getRegistrableDomain('[::1]')).toBeNull();
  });

  it('returns null for single-label and empty hosts', () => {
    expect(getRegistrableDomain('intranet')).toBeNull();
    expect(getRegistrableDomain('')).toBeNull();
  });
});
