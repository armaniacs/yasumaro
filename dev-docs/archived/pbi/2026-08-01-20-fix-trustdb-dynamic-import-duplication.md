# PBI: trustDb.tsの動的import重複をヘルパー関数に集約する

**作成日**: 2026-08-01
**優先度**: Low
**見積もり**: 🟢低（1pt目安）
**副作用**: 🟢なし（内部実装のリファクタリングのみ、外部から見た挙動は変わらない）

---

## 背景

直前のコードレビュー（fix-0801bブランチ、PBI-16実装分）での指摘。`src/utils/trustDb/trustDb.ts` の `getSavedTrancoVersion()` / `updateTrancoVersion()` / `getSavedTrancoDomains()` の3つのメソッドが、それぞれ個別に以下の動的importを行っている（重複）。

```ts
const { getSettings } = await import('../storage/settingsStore.js');
const { StorageKeys } = await import('../storage/types.js');
```

動的importを使う理由は `settingsStore.ts` との循環参照回避（`settingsStore.ts` 側も `trustDb.ts` を動的importしている）で、これ自体は妥当な設計。ESMの動的importは2回目以降モジュールキャッシュされるためパフォーマンス影響はほぼ無視できるが、同じ2行が3箇所に重複しておりコードの保守性の観点で改善余地がある。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "await import('../storage/settingsStore.js')\|await import('../storage/types.js')" src/utils/trustDb/trustDb.ts
grep -n "await import('../trustDb/trustDb.js')" src/utils/storage/settingsStore.ts
```

`settingsStore.ts` → `trustDb.ts` の動的import（循環参照回避のため）と、今回対象の `trustDb.ts` → `settingsStore.ts` の動的importが、依然として循環していないか（片方向の動的importで循環を断ち切れているか）を再確認してから着手する。

## 受け入れ基準（BDD）

```gherkin
Scenario: 動的importがヘルパー関数に集約される
  Given trustDb.tsのgetSavedTrancoVersion/updateTrancoVersion/getSavedTrancoDomainsメソッド
  When これらのメソッドがsettingsStoreの機能を必要とする
  Then 個別に動的importを書くのではなく共通のヘルパー関数経由でアクセスする

Scenario: 循環参照が発生しない
  Given リファクタリング後のtrustDb.ts
  When モジュールをビルド・型チェックする
  Then 循環参照エラーやビルド失敗が発生しない

Scenario: 既存のtrustDb関連テストが回帰しない
  Given 変更後のtrustDb.ts
  When 既存のtrustDb関連テストを実行する
  Then 全てパスする
```

## 受け入れ基準
- [ ] 3箇所の重複する動的import（`getSettings`/`saveSettings`/`StorageKeys`）を、1つのプライベートヘルパー関数（または遅延初期化パターン）に集約する
- [ ] ヘルパー関数はモジュールを1度だけ動的importし、以降はキャッシュされた参照を再利用する
- [ ] 既存の `trustDb` 関連テストが全てパスする
- [ ] `npm run type-check` が成功する（循環参照によるビルド時エラーがないこと）

## テスト戦略（t_wadaスタイル）

### 単体テスト
- 既存の `trustDb.test.ts` の `updateTrancoVersion` / `getSavedTrancoVersion` / `getSavedTrancoDomains` 関連テストがすべて変更なしでパスすることを確認する（内部実装の変更のみで、外部から見た挙動は変わらないため新規テストは不要）

## 実装アプローチ
- **Outside-In**: 既存テストを先に実行しグリーンであることを確認 → ヘルパー関数へ集約するリファクタリングを実施 → 再度グリーンであることを確認

## 見積もり

1pt（3箇所の重複コードを1つのヘルパーに集約するのみ）

## 技術的考慮事項
- 依存関係: `src/utils/trustDb/trustDb.ts` のみ
- テスタビリティ: 既存テストで十分カバー可能
- 非機能要件: 保守性向上が主目的（パフォーマンス改善ではない）

## 実装手順（例）

```ts
// モジュールスコープでキャッシュする簡易メモ化ヘルパー
let settingsStoreModule: typeof import('../storage/settingsStore.js') | undefined;
let storageTypesModule: typeof import('../storage/types.js') | undefined;

async function getSettingsStore() {
  if (!settingsStoreModule) {
    settingsStoreModule = await import('../storage/settingsStore.js');
  }
  return settingsStoreModule;
}

async function getStorageTypes() {
  if (!storageTypesModule) {
    storageTypesModule = await import('../storage/types.js');
  }
  return storageTypesModule;
}
```

各メソッド内では `const { getSettings } = await getSettingsStore();` のように呼び出す。

## 落とし穴
- ESMの動的import自体が既にモジュールキャッシュを持つため、上記のような手動メモ化は実質的にコード可読性向上のみが目的であり、パフォーマンス上のゲインはほぼない。過剰な抽象化にならないよう、シンプルなヘルパー関数に留めること
- テスト側で `vi.mock('../../storage/settingsStore.js', ...)` を使っている箇所（`trustDb.test.ts`）が、ヘルパー関数経由でも正しくモックされることを確認する（動的importの呼び出し方が変わってもvi.mockのモジュールモックは通常影響を受けないはずだが、念のため確認）

## Definition of Done
- [x] 3箇所の重複する動的importがヘルパー関数に集約されている
- [x] 既存の`trustDb`関連テストが全てパスする
- [x] `npm run type-check`が成功する
- [x] `pbi/00-INDEX.md` が更新されている

## 実装メモ（2026-08-01完了）

`getSettingsStore()`/`getStorageTypes()`という2つのモジュールスコープのメモ化ヘルパーを`trustDb.ts`冒頭（`TrustDbState`インターフェース定義の直前）に追加し、`getSavedTrancoVersion()`/`updateTrancoVersion()`/`getSavedTrancoDomains()`の3箇所をこのヘルパー経由に置き換えた。循環参照回避のための動的import自体は維持し、重複コードのみ解消した。`trustDb.test.ts`の`vi.mock('../../storage/settingsStore.js', ...)`はヘルパー経由でも正しく機能することを確認済み（モジュール全体をモックしているため呼び出し方法の変更に影響されない）。`npm run type-check`成功、`npm run build`成功（循環参照エラーなし）、既存165件のtrustDb関連テスト全てパス。

## 関連
- コードレビュー: fix-0801bブランチ未コミット変更（PBI-13〜16実装）に対するレビュー、Suggestions #3（Maintainability）
- 対象コード: `src/utils/trustDb/trustDb.ts`（`getSavedTrancoVersion`/`updateTrancoVersion`/`getSavedTrancoDomains`）
- 前提PBI: `dev-docs/archived/pbi/2026-08-01-16-fix-trustdb-settings-store-unification.md`（動的importパターンの導入経緯）
