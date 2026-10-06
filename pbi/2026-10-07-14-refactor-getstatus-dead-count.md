# PBI: handleGetStatus の誰も読まない count を削除する

## ユーザーストーリー

STATUS メッセージの保守担当者として、wire 上に誰もデコードしない count が乗っていてほしくない。毎 STATUS で余分な COUNT クエリが走り、canonical count と soft-deleted 語義も不一致のまま混乱を生むから。

## 優先度

- 順位: 14/17
- RICE: 2.0（R2 / I0.5 / C1.0 / E0.5）
- 根拠: dead computation の除去（誰も読まない + 語義不一致の twin は後の読み手が誤用する）
- 依存: なし

## 背景（file:line 現状）

- 計算: `src/offscreen/opfsWorker/statusHandlers.ts:15-16,23` — `'SELECT COUNT(*) AS c FROM browsing_logs'`（is_deleted フィルタなし）を count として返す
- 誰も読まない: `src/offscreen/StorageBackend.ts:57-62`（StatusResult に count なし）/ `src/messaging/sqliteMessages.ts:196-218`（SqliteStatusResult に count なし）/ `src/messaging/dashboardSqliteProtocol.ts:133-151`（dashboard status 応答に count なし）/ `src/background/sqlite/offscreenGateway.ts:202`（status pick が count を射影しない）
- 語義不一致: canonical live count は `WHERE is_deleted = 0`（`crudHandlers.ts:102`）。誰かが status.count を読み始めると soft-deleted 行を含む

## BDD受け入れシナリオ

```gherkin
Scenario: STATUS から dead count が消える
  Given handleGetStatus が count を返している
  When count を削除する
  Then 3 hop（worker/gateway/dashboard）の STATUS 形状が不変のまま green である

Scenario: canonical count との twin が消える
  Given getCount が live count の唯一の源
  When status.count が削除される
  Then 語義不一致の near-twin がリポジトリから消える
```

## 受け入れ基準

- [ ] handleGetStatus の count SELECT と応答フィールドを削除
- [ ] worker 側 STATUS 応答型（opfsWorker/types.ts）から count を削除
- [ ] STATUS 形状の 3 hop（worker/gateway/dashboard）が不変であることを既存テストで確認
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- unit: `src/offscreen/__tests__/` の status 系テストを維持。wire 形状が不変であることを pin
- 配置: `src/**/__tests__/`、実時間待ちは使わない

## 見積もり

0.5 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
