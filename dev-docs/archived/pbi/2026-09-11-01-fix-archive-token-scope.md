# PBI 01: archive confirm token の scope binding を残り 4 subtype に拡張

## ユーザーストーリー

archive 機能を使う利用者として、confirm token が「破壊的パラメータ（stagingName）」に束縛され、別 staging へのリプレイが不可能であることを知りたい。なぜなら PBI 2026-09-06-01 の設計意図は「payload が途中で差し替えられたら fail-closed で落とす」だが、現状 `archive_open/update/save/close` は token と stagingName が紐付かず、stagingA 用 token が stagingB に使えてしまうから。

## 優先度

- 順位: 01 / 9
- RICE スコア: 96.0（Reach=4 / Impact=3 / Confidence=80% / Effort=0.1 人週）
- 根拠: `src/messaging/sqliteOperationSecurity.ts:117-124` の `ARCHIVE_SCOPE_BY_SUBTYPE` は 6 subtype のみ。token 必須（`TOKEN_REQUIRED_SUBTYPES`、`sqliteOperationSecurity.ts:99-102`）でありながら scope 未バインドの archive subtype が 4 件残存（archive_open / archive_update / archive_save / archive_close — いずれも payload に `stagingName` を持つ: `archiveWireTable.ts` 各行・`dashboardSqliteService.ts:420-442`）。archive payload には `id` が無いため `index.ts:46` の `id` は常に undefined → subtype 単位で token が共用になる。送信側 `dashboardGateway.ts:48` と検証側 `index.ts:53` が同一 SSOT（`deriveScopeHash`）から派生するため、テーブル追記 1 箇所で両 hop が自動修復する。

## BDD 受け入れシナリオ

```gherkin
Scenario: stagingA 用 token は stagingB で検証に失敗する
  Given dashboard が stagingName "staging-a" で archive_open の token を発行した
  When  同一 token で stagingName "staging-b" の archive_open を送信する
  Then  verify は scopeHash 不一致で失敗し "Confirmation token mismatch" を返す

Scenario: 正しい stagingName を持つ要求は成功する
  Given dashboard が stagingName "staging-a" で archive_update の token を発行した
  When  同一 token・同一 stagingName で archive_update を送信する
  Then  verify が成功し handler が実行される

Scenario: 破壊的パラメータを持たない subtype は従来どおり
  Given archive_prepare_incoming / archive_cleanup は payload に破壊的パラメータを持たない
  When  token を発行して送信する
  Then  scopeHash は undefined のまま従来契約で検証される
```

## 受け入れ基準

- [x] `ARCHIVE_SCOPE_BY_SUBTYPE` に `archive_open` / `archive_update` / `archive_save` / `archive_close` を `'staging'` で追加
- [x] `archive_prepare_incoming` / `archive_cleanup` が不バインドである理由（破壊的パラメータ無し）をコメントで明記
- [x] 送信側（dashboardGateway）・検証側（dashboardSqlite/index）の既存派生コードは無修正で動く
- [x] staging 間リプレイ拒否のリグレッションテスト（confirmTokenManager の scopeHash compare `:137` を経由）を追加
- [x] 既存 archive 系テスト（token 発行フローを持つもの）全 green

## テスト戦略

- 単体: `deriveScopeHash('archive_open', {stagingName})` が undefined でないことを検証
- 統合: dashboardSqliteMock / 実 handler で staging 間リプレイが拒否されること
- 既存: archive session E2E（archive-recommended-verification.spec.ts）の token フローが green

## 見積もり

S（0.1 人週）。種別: fix（セキュリティ）。

## 実装アプローチ

1. `sqliteOperationSecurity.ts` の `ARCHIVE_SCOPE_BY_SUBTYPE` に 4 行追加 + prepare/cleanup 不バインドの理由コメント
2. scope binding のテーブル整合テスト（ALL subtypes のうち stagingName を持つものが全て 'staging' 束縛を持つ drift ガード）を新設 — `archiveWireTable.ts` の payload 定義を参照して検証
3. 既存テスト実行

## 実装メモ（2026-09-11）

- `ARCHIVE_SCOPE_BY_SUBTYPE` に archive_open / archive_update / archive_save / archive_close を 'staging' で追加。prepare_incoming / cleanup は不バインド（破壊的パラメータ無し）をコメント明記。
- drift ガード `sqliteOperationSecurity-scope.test.ts` 新設: token-required かつ未バインドの archive subtype が現れたら失敗（新 subtype 追加時の表更新漏れを構造的に防ぐ）。staging 間 hash 差分・prepare/cleanup 不バインドも検証。
- 送信側（dashboardGateway）・検証側（dashboardSqlite/index）は同一 SSOT から派生のため無修正。
