# ADR 2026-08-20: Utils Layer 循環依存の記録と保護

## Status
Accepted

## Context

`src/utils/` の層構造を形式化する過程で、2つの循環依存が発見された。いずれも業務ルール上不可避であり、`await import()` による遅延 import で回避されている。コード上は「なぜこんな複雑な import なのか」と見えるため、将来のリファクタで無意識に除去されるリスクがある。

### 循環 1: `settingsStore.ts` ↔ `trustDb.ts` (双方向)

```
settingsStore.ts (L72)
  const { getTrustDb } = await import('../trustDb/trustDb.js');

trustDb.ts (L62-66)
  async function getSettingsStore() {
    settingsStoreModule = await import('../storage/settingsStore.js');
  }
```

* **なぜ循環するのか**:
  * `settingsStore.ts` → `trustDb.ts`: `getSettings()` 初回実行時に TrustDb の初期化をトリガーする必要がある (Tranco ドメインリストの可用性チェック)
  * `trustDb.ts` → `settingsStore.ts`: Tranco バージョンの保存/読取 (`getSettings`, `saveSettings`) が `settingsStore` に依存する。`TrancoVersionTracker` は `getSettingsStore()` を依存注入で受け取る (L109-113)

* **回避手法**: 双方とも `await import()` による動的 import。ESM モジュールキャッシュにより2回目以降は即時解決し、実行時の循環初期化エラーは発生しない。`trustDb.ts` では `getSettingsStore()` をメモ化し、`TrancoVersionTracker` に注入する。

* **削除できない理由**: Tranco バージョンの source-of-truth が `settingsStore` にあり、TrustDb がそれを参照する業務ルールは変更できない。分離すると version の二重管理が発生する。

### 循環 2: `storageMaintenance.ts` → `background/sqliteClient.ts` (逆方向依存)

```
storageMaintenance.ts (L13)
  const { SqliteClient } = await import('../../background/sqliteClient.js');
```

* **なぜ逆方向なのか**: `utils/` は本来 `background/` に依存すべきでないが、legacy storage のクリーンアップ時に SQLite の状態確認が必要なため、例外的に `background` 層を呼び出す。
* **回避手法**: `await import()` による遅延 import で静的依存を断つ。
* **将来の扱い**: `storageMaintenance` を `background/` に移動するか、`sqliteClient` の interface を `utils/` に抽出することで解消可能。ただし現時点では 2pt のスコープ外のため、例外として記録し将来の PBI で検討する。

### 循環 3: `trancoConsentManager.ts` → `storage.ts` barrel + `settingsStore`

```
trancoConsentManager.ts (L12)  import { StorageKeys } from '../storage.js';  // barrel経由 (静的)
trancoConsentManager.ts (L119,133,150)  await import('../storage/settingsStore.js');  // 動的
```

* `StorageKeys` は `types.ts` のプレーンオブジェクトであり、実行時の循環依存にはならない。`settingsStore` の関数は動的 import で回避。

## Decision

1. 上記3つの循環 (特に循環1) は **削除不可** とし、将来のリファクタで除去しない。
2. 回避手法 (`await import()` による遅延 import) を維持する。静的 import に戻さない。
3. `dev-docs/LAYERS.md` に Layer 1-循環 として明記し、本 ADR を参照する。
4. 各ファイルの先頭に `// @layer` コメントで層を明示し、grep で検証可能にする。

## 将来の解消計画（PBI 01 SettingsRepository Seam で追記）

### TrancoVersionTracker の StorageAdapter 化

**現状**: `trustDb.ts` が `getSettingsStore()` 経由で `settingsStore` に動的依存

**将来的に**: `TrancoVersionTracker` に `StorageAdapter` を注入し、`settingsStore` への依存を物理的に断つ

```typescript
// 将来のコンストラクタ
class TrancoVersionTracker {
  constructor(private storage: StorageAdapter) {}
  async getSavedTrancoVersion(): Promise<string | null> {
    const r = await this.storage.get([StorageKeys.TRANCO_VERSION]);
    return r[StorageKeys.TRANCO_VERSION] as string | null;
  }
}
```

**移行ステップ**:
1. `TrancoVersionTracker` のコンストラクタに `StorageAdapter` を追加
2. `trustDb.ts` で `TrancoVersionTracker` を初期化する際、`new ChromeStorageAdapter()` または `settingsRepository` の adapter を注入
3. `getSettingsStore()` の動的 import を削除（`settingsStore` 側の循環 import も不要に）

**リスク**: `getSettings()` 初回実行時の `db.initialize()` タイミングが変わる可能性
**検証**: v6.7.43 の暗号化キー救済マイグレーションとの整合性を確認必要
**見積もり**: 別PBIで 0.5人月
**判断**: 今回のPBIでは `SettingsRepository` の深さに集中し、循環の物理的解消は次PBIで実施。ADR は保護のまま維持。

## Consequences

* **Positive**: 循環の存在理由が文書化され、将来の開発者が「不要な複雑さ」と誤認して削除するリスクを防止する。
* **Negative**: 循環自体は残るため、完全な層分離は達成されない。ただし Tranco version の一元管理という業務制約を満たすため、トレードオフとして許容する。
* **Neutral**: 動的 import は ESM キャッシュで性能影響なし。テストでは `vi.mock` でモック可能。

## References

* src/utils/storage/settingsStore.ts:72
* src/utils/trustDb/trustDb.ts:62-66, 109-113
* src/utils/storage/storageMaintenance.ts:13
* dev-docs/LAYERS.md — 層定義の SSOT
* PBI 2026-08-22-02-refactor-utils-layer-boundary

