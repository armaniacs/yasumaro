import { describe, it, expect, vi } from 'vitest';
import { ServiceContainer, ServiceTokens } from '../serviceContainer.js';

describe('ServiceContainer coverage — register/resolve/has/override 4分岐', () => {
  it('has: false for unregistered key, true after register', () => {
    const c = new ServiceContainer();
    expect(c.has(ServiceTokens.sessionStore)).toBe(false);
    expect(c.has('customKey')).toBe(false);
    c.register(ServiceTokens.sessionStore, () => ({ id: 1 }));
    expect(c.has(ServiceTokens.sessionStore)).toBe(true);
    expect(c.has('customKey')).toBe(false);
  });

  it('register non-singleton: resolve returns fresh instance each time', () => {
    const c = new ServiceContainer();
    let counter = 0;
    c.register('counter', () => ({ n: ++counter }));
    const a = c.resolve<{ n: number }>('counter');
    const b = c.resolve<{ n: number }>('counter');
    expect(a.n).toBe(1);
    expect(b.n).toBe(2);
    expect(a).not.toBe(b);
  });

  it('register singleton:true: resolve memoizes factory', () => {
    const c = new ServiceContainer();
    const factory = vi.fn(() => ({ id: Math.random() }));
    c.register('singletonSvc', factory, { singleton: true });
    const a = c.resolve('singletonSvc');
    const b = c.resolve('singletonSvc');
    expect(factory).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('singleton factory not called until first resolve', () => {
    const c = new ServiceContainer();
    const factory = vi.fn(() => ({ val: 1 }));
    c.register('lazy', factory, { singleton: true });
    expect(factory).not.toHaveBeenCalled();
    c.resolve('lazy');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('register singleton:false explicit also creates fresh', () => {
    const c = new ServiceContainer();
    const factory = vi.fn(() => ({}));
    c.register('explicit', factory, { singleton: false });
    c.resolve('explicit');
    c.resolve('explicit');
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('resolve throws for unregistered key (branch)', () => {
    const c = new ServiceContainer();
    expect(() => c.resolve('missing')).toThrow('ServiceContainer: no registration for "missing"');
    expect(() => c.resolve(ServiceTokens.obsidian)).toThrow('no registration');
  });

  it('override replaces registration with fixed instance (singleton)', () => {
    const c = new ServiceContainer();
    c.register('svc', () => ({ v: 1 }));
    expect(c.resolve<{ v: number }>('svc').v).toBe(1);
    const fake = { v: 99 };
    c.override('svc', fake);
    expect(c.resolve('svc')).toBe(fake);
    expect(c.resolve('svc')).toBe(fake);
    expect(c.has('svc')).toBe(true);
  });

  it('override works for unregistered key as well', () => {
    const c = new ServiceContainer();
    expect(c.has('newKey')).toBe(false);
    c.override('newKey', { hello: 'world' });
    expect(c.has('newKey')).toBe(true);
    expect(c.resolve<{ hello: string }>('newKey')).toEqual({ hello: 'world' });
  });

  it('override singleton instance is memoized (factory not called, instance reused)', () => {
    const c = new ServiceContainer();
    const instance = { id: 42 };
    c.override('over', instance);
    const a = c.resolve<typeof instance>('over');
    const b = c.resolve<typeof instance>('over');
    expect(a).toBe(instance);
    expect(b).toBe(instance);
    expect(a).toBe(b);
  });

  it('register after override replaces override', () => {
    const c = new ServiceContainer();
    c.override('key', { v: 1 });
    c.register('key', () => ({ v: 2 }));
    expect(c.resolve<{ v: number }>('key').v).toBe(2);
  });

  it('multiple tokens isolated', () => {
    const c = new ServiceContainer();
    c.register(ServiceTokens.sessionStore, () => 'a');
    c.register(ServiceTokens.obsidian, () => 'b', { singleton: true });
    expect(c.resolve<string>(ServiceTokens.sessionStore)).toBe('a');
    expect(c.resolve<string>(ServiceTokens.obsidian)).toBe('b');
    expect(c.has(ServiceTokens.sessionStore)).toBe(true);
    expect(c.has(ServiceTokens.obsidian)).toBe(true);
    expect(c.has(ServiceTokens.aiService)).toBe(false);
  });

  it('default opts singleton falsy branch vs truthy', () => {
    const c = new ServiceContainer();
    // default = falsy (no singleton)
    c.register('def', () => ({}));
    const a = c.resolve('def');
    const b = c.resolve('def');
    expect(a).not.toBe(b);
    // explicit truthy
    c.register('truthy', () => ({}), { singleton: true });
    const c1 = c.resolve('truthy');
    const c2 = c.resolve('truthy');
    expect(c1).toBe(c2);
  });
});
