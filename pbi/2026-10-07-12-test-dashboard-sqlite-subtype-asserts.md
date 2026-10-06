# PBI: DASHBOARD_SQLITE subtype の response union / validator spec を fail-closed にする

## ユーザーストーリー

dashboard-SQLite wire 契約の保守担当者として、新 subtype 追加時に忘れた箇所が type-check / テストで落ちてほしい。response union の success 側と validator spec の行が忘れても compile・実行とも黙って通るから。

## 優先度

- 順位: 12/17
- RICE: 2.0（R3 / I1 / C1.0 / E1.5）
- 根拠: trust boundary での fail-open（未定義 spec = payload 検査なし）を型・テストで fail-closed にする。compile-time assert 流儀は既存（`dashboardSqliteProtocol.ts:88-93`）が実証済み
- 依存: なし

## 背景（file:line 現状）

- 正リスト: `src/messaging/sqliteOperationSecurity.ts:77-112`（ALL_DASHBOARD_SQLITE_SUBTYPES）
- response union: `src/messaging/dashboardSqliteProtocol.ts:121-176` — `DashboardSqliteResponseFor` が never で終わるが、subtype セットとの assert がない（忘れると gateway の `Extract<...>` が silently never に崩れる）
- validator spec: `src/messaging/validators.ts:317-401` — `DASHBOARD_SQLITE_SUBTYPE_SPECS` が string-keyed Record。忘れた行 = payload 検査なし（`validators.ts:438-448` が spec 未定義を skip）
- 影響: 新 subtype 追加時に response 形状が未定義のまま通る・payload 検査が素通りする

## BDD受け入れシナリオ

```gherkin
Scenario: success 側の欠落が type-check で落ちる
  Given 新 subtype を ALL_DASHBOARD_SQLITE_SUBTYPES に追加した
  When DashboardSqliteResponseFor に対応行がない
  Then compile-time assert が type-check を失敗させる

Scenario: spec 行の欠落がテストで落ちる
  Given 新 subtype に DASHBOARD_SQLITE_SUBTYPE_SPECS の行がない
  When 全subtype 反復テストを実行する
  Then 未定義の subtype でテストが失敗する
```

## 受け入れ基準

- [ ] dashboardSqliteProtocol.ts に success 側欠落 subtype を集める compile-time assert を追加（既存 :88-93 流儀）
- [ ] DASHBOARD_SQLITE_SUBTYPE_SPECS の全subtype 反復テストを追加（query 等の意図的未定義があれば明示 allowlist で pin）
- [ ] 既存 subtype で assert / テストが green であること
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- unit: `src/messaging/__tests__/`（実在テストに追従）に反復 assert 追加。compile-time assert は type-check ゲート
- 実時間待ちは使わない

## 見積もり

1.5 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
