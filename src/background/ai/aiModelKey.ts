/**
 * aiModelKey.ts (background/ai)
 * Shared provider → settings-key resolution for AI model configuration.
 *
 * Moved here from src/utils/aiModelKey.ts (PBI 2026-09-21-06): the resolver
 * reads the provider catalog, which lives in background/ai, so housing it in
 * utils created a forbidden utils→background static edge and dragged the
 * provider strategy graph through the utils layer. Its only production
 * consumer is RemoteAIService (background), so this is its natural home.
 *
 * The provider catalog (providerCatalog.ts) is the single source of truth:
 * every entry carries its modelKey, so no string-derivation fallback exists.
 * Unknown providers (unreachable via the catalog-driven UI) fall back to the
 * generic PROVIDER_MODEL key — fail-closed rather than guessing a stem.
 */

import { StorageKeys, type Settings } from '../../utils/storage/types.js';
import { getRegistryEntry } from './providerCatalog.js';

/**
 * Resolve the settings key holding a provider's model.
 * Every catalog provider returns its own modelKey; unknown providers fall
 * back to the generic provider_model key.
 */
export function resolveModelKey(provider: string): string {
    const entry = getRegistryEntry(provider);
    if (entry?.modelKey) {
        return entry.modelKey;
    }
    return StorageKeys.PROVIDER_MODEL;
}

/**
 * AiModelKey (PBI 2026-10-16-10: 値オブジェクト化)
 *
 * provider → settings-key 解決の値オブジェクト版。素のstringキー (resolveModelKey
 * の戻り値) を持ち歩くと「どのproviderのキーか」が落ち、Adapter・RemoteAIService
 * の各所で `settings[key]` 直読みが散る。ここにproviderとkeyを束ね、モデル値の
 * 読取りも集約する。resolveModelKey は既存呼出し互換のため残す (委譲はしない —
 * catalog SSOTの単一実装はあの関数のまま)。
 */
export class AiModelKey {
    private constructor(
        /** 解決対象のproviderId。 */
        public readonly provider: string,
        /** providerのモデルを保持するsettingsキー。 */
        public readonly key: string,
    ) {}

    /** catalog解決で1個作る唯一の作り方。未知providerは汎用キーに倒す。 */
    public static for(provider: string): AiModelKey {
        return new AiModelKey(provider, resolveModelKey(provider));
    }

    /** 同一providerのキー同士だけ等価。 */
    public equals(other: AiModelKey): boolean {
        return this.provider === other.provider && this.key === other.key;
    }

    /** blobからモデル値を読む。未設定・空文字は未設定扱い。 */
    public readModel(settings: Settings): string | undefined {
        const model = (settings as unknown as Record<string, unknown>)[this.key];
        return typeof model === 'string' && model.length > 0 ? model : undefined;
    }
}
