# PBI 05: e2e ハーネスの stale バージョン pin を package.json 派生に置換

## ユーザーストーリー

e2e を実行する開発者として、ハーネスが渡すメタデータがビルドと乖離せず、版上げのたびに e2e が rot しない状態を望む。なぜなら `archive_create` の `yasumaroVersion` が '6.7.114' にハードコードされ、現行 6.8.6 と乖離しているから。

## 優先度

- 順位: 05 / 10
- RICE スコア: 10.0（Reach=1 / Impact=0.5 / Confidence=100% / Effort=0.05 人週）
- 根拠: `testDir/e2e/fixtures/dashboardSqliteHelpers.ts:130` の `yasumaroVersion: '6.7.114'`。バージョン整合チェック（6.8.6）との乖離は監査メタデータの意味を失い、次の版上げで e2e が失敗 or 無意味化する。

## BDD 受け入れシナリオ

```gherkin
Scenario: e2e がビルドと同じバージョンを報告する
  Given package.json の version が 6.8.7 である
  When dashboardSqliteHelpers が archive_create を送る
  Then yasumaroVersion は 6.8.7 である（ハードコード無し）
```

## 受け入れ基準

- [x] `yasumaroVersion` を package.json 読み取り（fs 経由 or 共有ヘルパ）に置換
- [x] ハードコードバージョンの残存を grep で確認（testDir 内 0 件）

## テスト戦略

既存 e2e（make clean test の test 段）green。

## 見積もり

XS（0.05 人週）。種別: test。

## 実装アプローチ

1. helpers に version 読み取りヘルパ追加・置換

## 実装メモ（2026-09-11 round 5）

- `dashboardSqliteHelpers.ts` に `EXTENSION_VERSION`（package.json から読み取り）を新設し、`archive-required-verification.spec.ts` / `dashboard-archive.spec.ts` / helpers 内 3 箇所の '6.7.114' pin を置換。archiveDbReader.test の '6.7.114' は in/out 同値の fixture 値のため保持。
