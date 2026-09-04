# PBI 05: アラーム振り分けを AlarmRegistry の登録テーブルに集約

優先度: 5 位 / RICE 12.0 = (6 × 1 × 80%) / 0.4w / Strength: Strong
backlog: [2026-09-05-00-backlog-arch3.md](2026-09-05-00-backlog-arch3.md)
依存: なし（他 6 件と独立）

## ユーザーストーリー
Service Worker を保守する開発者として、5 系統のアラーム（daily-purge / local-md-flush / local-md-daily-flush / local-md-immediate / offline-network-retry）の生成＋振り分け＋失敗方針が 1 つの登録テーブルに集約されてほしい。なぜなら現状は `service-worker.ts` の生成（:28-56）・`alarmHandler.ts` の if-chain（:22-65）・各 helper の 3 箇所を同時編集する必要があり、失敗は void-fire で統一ログもないから。

## BDD受け入れシナリオ

```gherkin
Scenario: 新規ジョブは1行の宣言で追加できる
  Given 登録テーブルに1行追加した状態
  When  対応するアラームが発火する
  Then  生成・振り分け・ログがテーブル駆動で実行される

Scenario: flush 系2アームの重複が1宣言になる
  Given yasumaro-local-md-flush と yasumaro-local-md-immediate
  When  登録テーブルで同一エントリを共有する
  Then  flushBufferedExports の動的 import が1箇所になる

Scenario: 失敗は統一ログに残り、他ジョブを止めない
  Given いずれかのジョブが例外を投げる
  When  アラームが発火する
  Then  統一形式でログされ、他の flush は継続する（allSettled 維持）
```

## 受け入れ基準
- [x] `alarmHandler.ts` の if-chain（5 リテラル名）が登録テーブル駆動になる
- [x] `service-worker.ts` の `chrome.alarms.create` 呼び出しがテーブル spec から生成される
- [x] lazy import の失敗捕捉が統一される（void-fire のまま放置しない）
- [x] `SessionAlarmService`（独自 listener・session-timeout）は対象外・現状維持
- [x] health-check の piggyback（:59-62、PBI-2026-07-26-20）はテーブル上で明示エントリ化し、意図が残る
- [x] 既存 alarm suite が green

## テスト戦略（t_wadaスタイル）
### 単体テスト
- in-memory clock + fake queue adapter で dispatch を interface 経由で駆動（chrome スタブなし）
- 失敗ジョブの隔離テスト（1 失敗でも他が実行される）
### 統合テスト
- 既存の alarm テストはテーブル駆動に移行して green
### 例外ハンドリング
- lazy import 失敗・maintain 失敗の統一ログ形式

## 実装アプローチ
- **Outside-In**: 登録エントリ型（create spec + lazy loader + handler + failure policy）から設計 → if-chain をテーブルに置換 → 生成側を spec 駆動に

## 見積もり
0.4w

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: in-memory clock で発火タイミングを駆動、queue は fake adapter
- 非機能要件: アラーム名・発火間隔・fan-out 順序は不変。SW wake 後の再生成タイミングも不変

## 実装者向け注記

### 現状コードの確認
```bash
rg -n "chrome.alarms.create|onAlarm" src/background/service-worker.ts src/background/alarmHandler.ts src/background/SessionAlarmService.ts
```
2026-09-05 時点: alarmHandler.ts 66 行（if-chain 5 系統）、`yasumaro-local-md-flush`（:30-35）と `yasumaro-local-md-immediate`（:42-47）が同一本体（`flushBufferedExports` 動的 import）、offline-retry は 4-way `Promise.allSettled`（:55-63）＋ health-check piggyback（:59-62）。

### 実装手順
1. `src/background/alarmRegistry.ts` を新設: `AlarmEntry { name, create, load, run, failurePolicy }` + `createAlarmRegistry(entries, deps)`
2. 5 系統をエントリ化（flush 2 系統は同一 load を共有）
3. `service-worker.ts` の create 呼び出しを spec 駆動に、handler 配線を registry に
4. 既存テスト green → 新規テーブル駆動テスト追加

### 落とし穴
- piggyback health-check は「意図的な相乗り」であり、消さないこと（PBI-2026-07-26-20 の経緯をコメントに残す）
- `SessionAlarmService`（:189-200 独自 listener）は別関心（session-timeout）。統合しないこと
- lazy import の `void` は失敗捕捉付きの `void` にする（未処理 rejection を出さない）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] alarm 全テスト green
- [x] コードレビュー完了
- [x] ドキュメント更新（service-worker の composition 記述があれば同期）
