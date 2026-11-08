# PBI: Mutexの所有権検証とタイムアウト契約

## ユーザーストーリー
開発者として、Mutexの誤用(二重release、所有者外解除、0指定の黙殺)が早期に検出されてほしい、なぜなら相互排除の破れは記録パイプライン全体の競合バグになるから。

## 優先度
順位 11/17。RICE 40 (Reach=50 / Impact=1 / Confidence=80% / Effort=1人日)。根拠: PBI 07(recording-pipeline)への弱い順序前提のため07より先に着手推奨。

## BDD受け入れシナリオ

```gherkin
Scenario: 通常のacquireとreleaseは従来通り動く
  Given Mutexが未ロックである
  When 保持者がacquireしてreleaseする
  Then 排他が保たれ後続の取得が成功する

Scenario: 0指定は意図通り扱われるか拒否される
  Given 呼び出し側がタイムアウトに0を指定した
  When acquireを要求する
  Then 0が既定値に黙って置き換わらず意図通りの振る舞いか明示的な拒否になる

Scenario: 非保有者のreleaseは検出可能になる
  Given Mutexを保持していない主体がいる
  When その主体がreleaseを試みる
  Then 誤用として検出でき二重releaseが隠れない

Scenario: ハング保持者は検出可能になる
  Given 保持者が長時間解除しない
  When 監視の期限を過ぎる
  Then ハングとして検出でき同URLの詰まりが放置されない
```

## 受け入れ基準
- [x] 指摘(1)の0指定の扱いが明確になり回帰テストがある
- [x] 指摘(2)の未ロック時や所有者外のreleaseが検出でき回帰テストがある
- [x] 指摘(3)のハング保持者が検出でき回帰テストがある
- [x] 従来の正常系acquireとreleaseに退行がない

対象の指摘(検証済み3件):
- (1) src/utils/Mutex.ts:51-52 ― ||50と||30000により0指定が既定値に置き換わる
- (2) src/utils/Mutex.ts:121-125 ― 未ロック時のreleaseがWARNログとreturnのみで二重releaseを隠す。releaseは所有者トークンを取らずlocked真偽のみで解除する設計である
- (3) src/utils/Mutex.ts:90-99、121-148 ― timeoutが待機entry削除のみでholder用watchdogがない。perUrlMutex.ts:15のin-memory保持と合わせハング保持者がSW再起動まで同URLを詰まらせる

## テスト戦略
- 単体テストで誤用(二重release、所有者外解除、0指定)を模擬する
- 単体テストでハング保持者を模擬し検出を検証する
- 正常系のacquireとreleaseの回帰テストを行う

## 見積もり
- S

## Definition of Done
- [x] 全BDDシナリオが自動テスト化され成功する
- [x] 回帰テストが追加され成功する
- [x] レビューが完了する

出典: adversarial-code-review 2026-11-08。
