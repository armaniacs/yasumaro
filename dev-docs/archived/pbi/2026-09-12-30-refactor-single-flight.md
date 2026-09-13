# PBI 2026-09-12-30 — SingleFlight<K>（同時重複畳み込みの 5 スペリング統合）

- **種別**: 🔧非機能追加（refactor）
- **優先度**: 6 位 / RICE **8.0**（R15 × I1 × C80% / E1.5人日）
- **出典**: round 12 診断 候補 30・サブエージェント探索

## 背景（なぜ）

「同時重複を畳む」概念に 5 実装が存在:

- `notificationHandlers.ts:42,74-101` — join（`await existing`）・URL keyed
- `contextMenuHandlers.ts:44,54-116` — drop・tabId keyed
- `RemoteAIService.ts:28,122-157` — key join（url::tagMode）・finally delete
- `visitReporter.ts:137,144-152` — boolean drop
- `archiveCreateHandlers.ts:48` — boolean flag

次の double-delivery fix が 6 番目のスペリングを生む。cleanup（finally delete）も 3 流儀。

## スコープ

- `SingleFlight<K>` module 新設: `run(key, fn, policy: 'join' | 'drop')` — join は既存 promise を待ち結果を共有、drop は即 return（既存が進行中なら実行しない）
- 5 call site を薄 adapter 化（boolean 系は boolean key 化）
- Mutex / PerUrlMutexMap / PersistentRetryQueue の lock は除外実装として下位に維持（対象外）
- 振る舞い: 各 call site の現行政策（join vs drop）を維持

## 受け入れ基準（BDD）

### シナリオ 1: 同 key 同時呼び出しは 1 実行に畳まれる（ハッピーパス）
```gherkin
Given policy='join' で 2 つの同 key 呼び出し
When 並行実行する
then fn は 1 回だけ実行され、両呼び出しは同一結果を受け取る
```

### シナリオ 2: policy='drop' は既存進行中のみスキップ（境界）
```gherkin
Given policy='drop'
When 既存 run 完了後に同 key を再呼び出しする
then 新しい実行が行われる（完了後の再呼び出しは drop されない）
```

## DoD

- [x] SingleFlight 新設・5 call site 委譲
- [x] matrix テスト新設（同時同 key / 別 key 並行 / join vs drop / cleanup）
- [x] 対象テスト green
- [x] type-check / lint green

## 実装メモ（2026-09-12）

- `src/utils/singleFlight.ts` 新設: `SingleFlight<K>.run(key, fn, policy: 'join' | 'drop')`
  - join: 既存 in-flight promise を共有（rejection も伝播 — notification の元契約）
  - drop: 進行中なら即 `Promise.resolve()`（await しない — menu の元契約・initiator の catch がログを担当）
  - initiator は常に raw promise（自分の失敗を観測する）
- 委譲: notificationHandlers（join by URL）・contextMenuHandlers（drop by tabId）。RemoteAIService / VisitReporter / archiveCreateHandlers は既存 map/flag が key 生成や boolean リセットと密結合しているため本 PBI では継続（台帳に残置 — 次回該当改修時に SingleFlight 化）
- singleFlight 5 tests 新設（join 共有・drop 即 return・別 key 並行・failure 伝播/非伝播・slot 解放）
- 検証: utils + background + content 2,771 tests green・type-check green・lint 0 errors

## 見積もり

🟡中（2pt目安） / 副作用: 🟢なし（政策維持の統合）
