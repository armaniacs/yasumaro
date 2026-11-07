# PBI 2026-11-08-01: SW module-let state の session 永続化と注入必須化

## メタ情報

- ラウンド: arch-delivery-loop archloop-1108
- 順位: 1/9
- RICE: 12 (R6 / I2 / C1.0)
- 依存: なし
- 種別: fix
- 規模: M
- プライバシー: 履歴の外部送信なし、鍵復号の移動なし
- 振る舞い変更: 再起動後の stale 抑止のみ (正常系の値は不変)

## ユーザーストーリー

保守担当者として、SW再起動で失われる module-let 状態を session 永続化または注入に寄せてほしい。なぜなら digest 二重実行・計数過少申告・queue 二重生成が再起動のたびに起きうるから。

## 背景 (Read確認済み)

- `src/background/digestBatchAlarm.ts:70`: `let latestRunToken = 0` (`:77-79` stale判定)。再起動で0に戻る。
- `src/background/handlers/envelopePolicy.ts:93`: `let absentVersionCounter = 0`。Session-scopedと自己申告し再起動リセット。
- `src/background/sqlite/offscreenGateway.ts:233`: `let sharedInstance: SqliteClient | null`。
- `src/background/handlers/dashboardSqlite/deps.ts:147`: `let obsidianSingleton: ObsidianClient | undefined`。
- `src/background/pendingChromeStorageQueue.ts:143` / `pendingSqliteQueue.ts:101`: `let activeQueue ... | undefined` (ADR 2026-09-17引用でexempt主張。ルールと実装が食い違う)。
- 模範: `src/background/sqliteAlert.ts:29-94` は session書込+rehydrate (`restoreSqliteAlertState`) で解決済み。
- 約束事: AGENTS.md「SWはstateless。状態はchrome.storage」。

## BDD受け入れシナリオ

```gherkin
Scenario: 再起動後もdigest tokenが単調に進む
  Given digestBatchAlarmがtoken Nで動作中
  When SWが再起動する
  Then 復元後のtokenはN未満に戻らない
  And stale判定が誤って旧実行を生かさない
```

```gherkin
Scenario: singletonがcomposition root経由で共有される
  Given gateway/queue singletonがlazy defaultを持つ
  When テストがcontainer overrideで差し替える
  Then 本番はcomposition rootの同一instanceを使う
  And 二重生成が起きない
```

## 受け入れ基準

- [x] token・計数が `chrome.storage.session` 書込+起動時復元する (sqliteAlert方式)。または失われてよい理由が各letに明示される
- [x] gateway/queue/singleton が composition root注入を必須化し lazy default がテスト専用に狭まる
- [x] pending queue の exempt コメントが現行ルールと一致する (免除なら理由、そうでないなら永続化)
- [x] 既存テスト緑。pin テスト (再起動復元) が1件以上追加される

## テスト戦略

- 単体: `src/background/__tests__/` に再起動復元 pin (session fake使用)。実時間待ちなし (`testDir/waitPolicy.ts`)。
- 統合: 既存 background 経路に任せる。E2E追加なし。
- 手動 (DoD分離): 実機で SW terminate→digest アラーム再発火の目視は owner 手順 (`dev-docs/TESTING_GUIDE.md`) に残す。

## 5 Whys記録先

- `/tmp/whywhy/2026-11-08-01-sw-let.md`
