import { describe, it, expect, vi } from 'vitest';
import { ServiceContainer } from '../serviceContainer.js';

describe('ServiceContainer coverage — register/resolve/has/override 4分岐', () => {
  it('has: false for unregistered key, true after register', () => {
    const c = new ServiceContainer();
    expect(c.has('sessionStore')).toBe(false);
    expect(c.has('tabCache')).toBe(false);
    c.register('sessionStore', () => ({ id: 1 }));
    expect(c.has('sessionStore')).toBe(true);
    expect(c.has('tabCache')).toBe(false);
  });

  it('register non-singleton: resolve returns fresh instance each time', () => {
    const c = new ServiceContainer();
    let counter = 0;
    c.register('rateLimiter', () => ({ n: ++counter }));
    const a = c.resolve<{ n: number }>('rateLimiter');
    const b = c.resolve<{ n: number }>('rateLimiter');
    expect(a.n).toBe(1);
    expect(b.n).toBe(2);
    expect(a).not.toBe(b);
  });

  it('register singleton:true: resolve memoizes factory', () => {
    const c = new ServiceContainer();
    const factory = vi.fn(() => ({ id: Math.random() }));
    c.register('manualContentFetcher', factory, { singleton: true });
    const a = c.resolve('manualContentFetcher');
    const b = c.resolve('manualContentFetcher');
    expect(factory).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('singleton factory not called until first resolve', () => {
    const c = new ServiceContainer();
    const factory = vi.fn(() => ({ val: 1 }));
    c.register('headerDetector', factory, { singleton: true });
    expect(factory).not.toHaveBeenCalled();
    c.resolve('headerDetector');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('register singleton:false explicit also creates fresh', () => {
    const c = new ServiceContainer();
    const factory = vi.fn(() => ({}));
    c.register('aiService', factory, { singleton: false });
    c.resolve('aiService');
    c.resolve('aiService');
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('resolve throws for unregistered key (branch)', () => {
    const c = new ServiceContainer();
    expect(() => c.resolve('sqliteClient')).toThrow('ServiceContainer: no registration for "sqliteClient"');
    expect(() => c.resolve('obsidian')).toThrow('no registration');
  });

  it('override replaces registration with fixed instance (singleton)', () => {
    const c = new ServiceContainer();
    c.register('tabCache', () => ({ v: 1 }));
    expect(c.resolve<{ v: number }>('tabCache').v).toBe(1);
    const fake = { v: 99 };
    c.override('tabCache', fake);
    expect(c.resolve('tabCache')).toBe(fake);
    expect(c.resolve('tabCache')).toBe(fake);
    expect(c.has('tabCache')).toBe(true);
  });

  it('override works for unregistered key as well', () => {
    const c = new ServiceContainer();
    expect(c.has('settingsRepository')).toBe(false);
    c.override('settingsRepository', { hello: 'world' });
    expect(c.has('settingsRepository')).toBe(true);
    expect(c.resolve<{ hello: string }>('settingsRepository')).toEqual({ hello: 'world' });
  });

  it('override singleton instance is memoized (factory not called, instance reused)', () => {
    const c = new ServiceContainer();
    const instance = { id: 42 };
    c.override('perUrlMutexMap', instance);
    const a = c.resolve<typeof instance>('perUrlMutexMap');
    const b = c.resolve<typeof instance>('perUrlMutexMap');
    expect(a).toBe(instance);
    expect(b).toBe(instance);
    expect(a).toBe(b);
  });

  it('register after override replaces override', () => {
    const c = new ServiceContainer();
    c.override('pendingWriteQueue', { v: 1 });
    c.register('pendingWriteQueue', () => ({ v: 2 }));
    expect(c.resolve<{ v: number }>('pendingWriteQueue').v).toBe(2);
  });

  it('multiple tokens isolated', () => {
    const c = new ServiceContainer();
    c.register('sessionStore', () => 'a');
    c.register('obsidian', () => 'b', { singleton: true });
    expect(c.resolve<string>('sessionStore')).toBe('a');
    expect(c.resolve<string>('obsidian')).toBe('b');
    expect(c.has('sessionStore')).toBe(true);
    expect(c.has('obsidian')).toBe(true);
    expect(c.has('aiService')).toBe(false);
  });

  it('default opts singleton falsy branch vs truthy', () => {
    const c = new ServiceContainer();
    // default = falsy (no singleton)
    c.register('offlineNetworkQueue', () => ({}));
    const a = c.resolve('offlineNetworkQueue');
    const b = c.resolve('offlineNetworkQueue');
    expect(a).not.toBe(b);
    // explicit truthy
    c.register('alarmRegistry', () => ({}), { singleton: true });
    const c1 = c.resolve('alarmRegistry');
    const c2 = c.resolve('alarmRegistry');
    expect(c1).toBe(c2);
  });
});
