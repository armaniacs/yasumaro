# PBI: flushBatch が over-retry/TTL drop を onDropped で報告しない（SQLite レコードの silent drop）

## ユーザーストーリー

閲覧履歴の欠落を検知したい保守担当者として、flushBatch 経路でレコードが drop された場合も flush() と同じ onDropped 契約で報告されてほしい。現状は flushBatch 側の drop が消費者に伝わらず、SQLite 挿入対象が静かに失われる。

## 優先度

- 順位: 03/20
- RICE: 18.0（R3 / I3 / C1.0 / E0.5）
- 根拠: 実検証済みの契約不一致 1 件。flush() は over-retry/TTL drop を onDropped で報告するが、flushBatch（persistentRetryQueue.ts:251-332）はログのみでコールバックが無く、pendingSqliteQueue.ts:95 の利用側では fallback owner 未指定の silent drop。監視データの欠落という見えない損害
- 依存: なし（`src/background/persistentRetryQueue.ts`・`src/background/pendingSqliteQueue.ts` とそのテスト）

## 背景（file:line 現状）

- `src/background/persistentRetryQueue.ts:251-332`: flushBatch は drop を `addLog(LogType.WARN)` で記録するのみ
  - filterExpiredAndOverRetry 由来の TTL/over-retry drop: :287-291
  - handler false 由来の over-retry drop: :303-307
  - handler throw 由来の over-retry drop: :317-321
  - → flush() が持つ onDropped コールバック契約が flushBatch には無い
- `src/background/pendingSqliteQueue.ts:95`: flushBatch の唯一の本番利用箇所。fallback owner が指定されておらず、drop が消費者側へ伝わらない（silent drop）
- 重複指摘（follow-up）: retry-block が 3 重に重複（:206-221 vs :222-234 vs :300-325）。自明な統合なら本 PBI 内で、そうでなければ別 PBI 化

## BDD受け入れシナリオ

```gherkin
Scenario: flushBatch の drop が onDropped で報告される
  Given maxRetryCount 超過と TTL 期限切れのアイテムが混在する
  When flushBatch が実行される
  Then drop された各アイテムが onDropped コールバック（flush() と同一契約）に渡る

Scenario: onDropped 未設定でも silent drop にならない
  Given onDropped が指定されていない
  When flushBatch で drop が発生する
  Then 既存の addLog WARN が最低限残り、例外にはならない

Scenario: SQLite 挿入の利用側で drop を検知できる
  Given pendingSqliteQueue の flush が実行される
  When レコードが drop される
  Then 利用側のコールバックが drop を受け取り、ログに記録される

Scenario: handler throw 経路でも報告される
  Given handler が例外を投げる
  When その結果 over-retry drop が発生する
  Then :317-321 相当の drop も onDropped で報告される
```

## 受け入れ基準

- [ ] `src/background/persistentRetryQueue.ts` の flushBatch（現 :251-332）に、flush() と同一契約の onDropped コールバックが追加され、3 経路（現 :287-291, :303-307, :317-321）の drop が報告される
- [ ] `src/background/pendingSqliteQueue.ts:95` の利用箇所が onDropped を受け取り、drop をログへ記録する
- [ ] onDropped 未指定時は既存の `addLog(LogType.WARN)` が最低限残る（silent drop 撲滅）
- [ ] retry-block 重複（現 :206-221 / :222-234 / :300-325）の統合は自明な場合のみ本 PBI 内で実施し、そうでなければ follow-up PBI として記録が残る
- [ ] drop 報告の単体テストが追加される（実時間待ちなし）
- [ ] 既存 flush/flushBatch テストが green

## テスト戦略

- 単体: handler 成功/false/throw × over-retry/TTL の組み合わせで onDropped 呼び出し（id・件数）を pin
- 単体: onDropped 未指定時の WARN ログ経路を pin
- 実時間待ち・固定 sleep は使わない。既存テスト green 維持 + `npm run validate` 通過

## 見積もり

1.0 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了
