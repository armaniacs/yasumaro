# PBI: unlimitedStorage権限保持時のストレージクォータ判定修正

## ユーザーストーリー
拡張機能ユーザーとして、実際には制限のないストレージ容量に対して誤ったクォータエラーが表示されないようにしてほしい、なぜなら現状の `STORAGE_QUOTA_BYTES` 定数（5MB）は `unlimitedStorage` 権限を持つ本拡張機能の実際の制約と乖離しているから

## ビジネス価値
- 誤ったクォータエラーによるユーザー混乱を防止
- 実際の制約（`unlimitedStorage` により事実上無制限）とコードの整合性確保

## 実装者向け注記（フェーズ0の既実装確認結果）

Read・grep で確認済み:
- `src/utils/storage/quota.ts:7` — `export const STORAGE_QUOTA_BYTES = 5 * 1024 * 1024; // 5MB`
- `wxt.config.ts:33` — `manifest.permissions` に `'unlimitedStorage'` が含まれる（確認済み）
- side-effects.md M7判定: 「`unlimitedStorage`権限があるため実質無害」だが、`savedUrlStore.ts:86-90` で誤ったクォータエラーが送出されうる、と親レポートで指摘
- 対処案: `unlimitedStorage` がある場合はクォータチェックをスキップ。定数を `chrome.storage.local.QUOTA_BYTES`（10MB）に合わせる

```bash
# 実装前の再確認コマンド
grep -n "STORAGE_QUOTA_BYTES" src/utils/storage/*.ts
sed -n '80,95p' src/utils/storage/savedUrlStore.ts
```

## BDD受け入れシナリオ

```gherkin
Scenario: unlimitedStorage権限がある場合はクォータチェックをスキップする
  Given 拡張機能がunlimitedStorage権限を保持している（本拡張機能の常時状態）
  When 大量データを保存しようとする
  Then STORAGE_QUOTA_BYTESに基づく誤ったクォータエラーが発生しない

Scenario: 定数値が実際のデフォルトクォータと一致する
  Given STORAGE_QUOTA_BYTES定数を参照するコード
  When 値を確認する
  Then chrome.storage.local.QUOTA_BYTES(10MB)と一致するか、unlimitedStorage判定により参照されない
```

## 受け入れ基準
- [x] `unlimitedStorage` 権限保持時はクォータチェックをスキップするロジックを `savedUrlStore.ts` のクォータ判定箇所に追加
- [x] `STORAGE_QUOTA_BYTES` 定数を実際のデフォルトクォータ（10MB）に合わせて修正
- [x] 既存のクォータ超過ハンドリング（万一 `unlimitedStorage` が将来外れた場合の備え）は削除せず残す

## テスト戦略（t_wadaスタイル）

### E2E（最小限）
- 不要

### 統合テスト
- `savedUrlStore.ts` のクォータチェック関連テストに、`unlimitedStorage` 権限ありのケースでエラーが発生しないことを検証するケースを追加

### 単体テスト
- クォータ判定ロジックに対して、`unlimitedStorage` あり/なしの両方のケースで正しく分岐することを検証

## 実装アプローチ
- **Outside-In**: 「unlimitedStorage権限がある状態で大量データ保存してもエラーにならない」統合テストをRedで書き、判定ロジック修正でGreenにする

## 見積もり
1pt（1時間程度）

## 技術的考慮事項
- 依存関係: `chrome.permissions.contains()` または manifest内の静的権限確認方法の選定が必要
- テスタビリティ: `chrome.permissions` APIのモックが必要（既存のテストヘルパーがあれば流用）
- 非機能要件: メモリ/パフォーマンス面の別制約に注意（side-effects.md M7の副作用軽微指摘を踏まえる）

## 落とし穴
- `unlimitedStorage` はmanifestで静的に宣言されている権限のため、実行時チェックは不要な場合がある（`chrome.permissions.contains` を使わずmanifest宣言を前提にした実装で十分な可能性）。実装時にどちらのアプローチが適切か既存コードのパターンを確認すること

## Definition of Done
- [x] クォータ判定ロジックが修正されている
- [x] 単体・統合テストが追加されパスする
- [x] `npm run type-check` / `npm test` が成功
- [x] コードレビュー完了
