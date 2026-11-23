import { describe, it, expect } from 'vitest';
import { compositionManifest } from '../compositionManifest.js';
import { SERVICE_KEYS, ServiceContainer, type ServiceKey } from '../serviceContainer.js';

describe('ServiceContainer keys', () => {
  describe('SERVICE_KEYS', () => {
    it('matches the composition manifest keys exactly (no drift either way)', () => {
      const manifestKeys = new Set(compositionManifest.map((entry) => entry.key));
      const declaredKeys = new Set<ServiceKey>(SERVICE_KEYS);

      for (const key of manifestKeys) {
        expect(declaredKeys.has(key), `manifest key "${key}" is missing from SERVICE_KEYS`).toBe(true);
      }
      for (const key of declaredKeys) {
        expect(manifestKeys.has(key), `SERVICE_KEYS entry "${key}" has no manifest entry`).toBe(true);
      }
      expect(declaredKeys.size).toBe(compositionManifest.length);
    });
  });

  describe('resolve', () => {
    it('accepts every manifest key without a type escape hatch', () => {
      const container = new ServiceContainer();
      const seen: ServiceKey[] = [];
      for (const key of SERVICE_KEYS) {
        container.register(key, () => ({ key }));
      }
      for (const key of SERVICE_KEYS) {
        const resolved = container.resolve<{ key: ServiceKey }>(key);
        expect(resolved.key).toBe(key);
        seen.push(resolved.key);
      }
      expect(seen).toHaveLength(SERVICE_KEYS.length);
    });
  });
});
